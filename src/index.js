import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import { log } from './logger.js';
import { initDatabase } from './database.js';
import { pollEvents } from './tasks/eventFetcher.js';
import { config, assertBotConfig, eventPollingEnabled } from './config.js';

assertBotConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildScheduledEvents],
});

client.commands = new Collection();
for (const cmd of await loadCommands()) {
  client.commands.set(cmd.data.name, cmd);
}

client.once(Events.ClientReady, (c) => {
  log.info(`Logged in as ${c.user.tag}`);
  log.info(`Serving ${c.guilds.cache.size} guild(s)`);

  if (eventPollingEnabled()) {
    pollEvents(client);
    setInterval(() => pollEvents(client), config.events.pollIntervalMs);
    log.info(`Event polling started (every ${config.events.pollIntervalMs / 1000}s)`);
  }
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

await initDatabase();
client.login(config.discord.token);

async function loadCommands() {
  const commandsDir = join(dirname(fileURLToPath(import.meta.url)), 'commands');
  const files = (await readdir(commandsDir)).filter((f) => f.endsWith('.js'));
  return Promise.all(files.map((f) => import(pathToFileURL(join(commandsDir, f)).href)));
}
