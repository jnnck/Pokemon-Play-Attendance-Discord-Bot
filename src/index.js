import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import { log } from './logger.js';

import * as uploadCommand from './commands/upload.js';
import * as registerCommand from './commands/register.js';
import * as leaderboardCommand from './commands/leaderboard.js';
import * as attendanceCommand from './commands/attendance.js';
import * as tournamentsCommand from './commands/tournaments.js';
import * as tournamentDeleteCommand from './commands/tournament-delete.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

client.commands = new Collection();

for (const cmd of [uploadCommand, registerCommand, leaderboardCommand, attendanceCommand, tournamentsCommand, tournamentDeleteCommand]) {
  client.commands.set(cmd.data.name, cmd);
}

client.once(Events.ClientReady, (c) => {
  log.info(`Logged in as ${c.user.tag}`);
  log.info(`Serving ${c.guilds.cache.size} guild(s)`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  const context = `/${interaction.commandName} — ${interaction.user.tag} (${interaction.user.id}) in #${interaction.channel?.name ?? 'unknown'}`;

  log.info(`Command: ${context}`);

  try {
    await command.execute(interaction);
    log.info(`Done:    ${context}`);
  } catch (err) {
    log.error(`Failed:  ${context}`, err);

    const payload = { content: 'Something went wrong. Please try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch((e) => log.error('Failed to send error reply:', e));
    } else {
      await interaction.reply(payload).catch((e) => log.error('Failed to send error reply:', e));
    }
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  log.error('Missing DISCORD_TOKEN in environment. Copy .env.example to .env and fill in your values.');
  process.exit(1);
}

client.login(token);
