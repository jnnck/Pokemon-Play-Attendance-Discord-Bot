import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import { log } from './logger.js';
import { M } from './messages.js';
import { initDatabase } from './database.js';
import { initStacksDb } from './stacksDb.js';
import { pollEvents } from './tasks/eventFetcher.js';
import { pollStacksEvents } from './tasks/stacksEventPoller.js';
import { pollReservationNotifications } from './tasks/reservationNotifier.js';

import * as uploadCommand from './commands/upload.js';
import * as registerCommand from './commands/register.js';
import * as leaderboardCommand from './commands/leaderboard.js';
import * as attendanceCommand from './commands/attendance.js';
import * as tournamentsCommand from './commands/tournaments.js';
import * as tournamentDeleteCommand from './commands/tournament-delete.js';
import * as eventsCommand from './commands/events.js';
import * as eventsClearCommand from './commands/events-clear.js';

import {
  handleSubscribeButton,
  handleSubscribeConfirm,
  handleSubscribeCancel,
  handleSubscribeModal,
  handleSubscribeUnregister,
} from './handlers/stacksSubscribe.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildScheduledEvents],
});

client.commands = new Collection();

for (const cmd of [uploadCommand, registerCommand, leaderboardCommand, attendanceCommand, tournamentsCommand, tournamentDeleteCommand, eventsCommand, eventsClearCommand]) {
  client.commands.set(cmd.data.name, cmd);
}

const POKEDATA_POLL_INTERVAL = 60_000; // 1 minute (external API, be polite)
const STACKS_POLL_INTERVAL = 10_000;   // 10 seconds (own DB)

client.once(Events.ClientReady, (c) => {
  log.info(`Logged in as ${c.user.tag}`);
  log.info(`Serving ${c.guilds.cache.size} guild(s)`);

  // Start event polling
  if (process.env.EVENTS_CHANNEL_ID && process.env.POKEMON_EVENT_LAT) {
    pollEvents(client);
    setInterval(() => pollEvents(client), POKEDATA_POLL_INTERVAL);
    log.info('Event polling started (every 60s)');
  }

  if (process.env.STACKS_SUBSCRIBE_CHANNEL_ID) {
    pollStacksEvents(client);
    setInterval(() => pollStacksEvents(client), STACKS_POLL_INTERVAL);
    log.info('Stacks event subscription polling started (every 10s)');
  }

  if (process.env.STACKS_RESERVATIONS_CHANNEL_ID) {
    pollReservationNotifications(client);
    setInterval(() => pollReservationNotifications(client), STACKS_POLL_INTERVAL);
    log.info('Reservation notifier polling started (every 10s)');
  }
});

async function replyWithError(interaction, err, context) {
  log.error(`Failed:  ${context}`, err);
  const payload = { content: M.genericError, ephemeral: true };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch((e) => log.error('Failed to send error reply:', e));
  } else {
    await interaction.reply(payload).catch((e) => log.error('Failed to send error reply:', e));
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    const context = `/${interaction.commandName} — ${interaction.user.tag} (${interaction.user.id}) in #${interaction.channel?.name ?? 'unknown'}`;
    log.info(`Command: ${context}`);

    try {
      await command.execute(interaction);
      log.info(`Done:    ${context}`);
    } catch (err) {
      await replyWithError(interaction, err, context);
    }
    return;
  }

  if (interaction.isButton()) {
    const context = `button:${interaction.customId} — ${interaction.user.tag}`;
    try {
      if (interaction.customId.startsWith('stacks-sub-confirm:')) {
        await handleSubscribeConfirm(interaction);
      } else if (interaction.customId.startsWith('stacks-sub-unregister:')) {
        await handleSubscribeUnregister(interaction);
      } else if (interaction.customId === 'stacks-sub-cancel') {
        await handleSubscribeCancel(interaction);
      } else if (interaction.customId.startsWith('stacks-sub:')) {
        await handleSubscribeButton(interaction);
      }
    } catch (err) {
      await replyWithError(interaction, err, context);
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    const context = `modal:${interaction.customId} — ${interaction.user.tag}`;
    try {
      if (interaction.customId.startsWith('stacks-sub-modal:')) {
        await handleSubscribeModal(interaction);
      }
    } catch (err) {
      await replyWithError(interaction, err, context);
    }
    return;
  }
});

process.on('unhandledRejection', (err) => log.error('Unhandled rejection:', err));
process.on('uncaughtException', (err) => log.error('Uncaught exception:', err));

const token = process.env.DISCORD_TOKEN;
if (!token) {
  log.error('Missing DISCORD_TOKEN in environment. Copy .env.example to .env and fill in your values.');
  process.exit(1);
}

await initDatabase();
log.info('Bot database initialised.');
await initStacksDb();
log.info('Logging in to Discord…');
try {
  await client.login(token);
} catch (err) {
  log.error('client.login failed:', err);
  process.exit(1);
}
