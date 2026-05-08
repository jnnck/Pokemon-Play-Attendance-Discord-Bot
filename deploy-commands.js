import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { REST, Routes } from 'discord.js';
import { config, assertDeployConfig } from './src/config.js';

assertDeployConfig();

const commandsDir = join(dirname(fileURLToPath(import.meta.url)), 'src', 'commands');
const files = (await readdir(commandsDir)).filter((f) => f.endsWith('.js'));
const modules = await Promise.all(files.map((f) => import(pathToFileURL(join(commandsDir, f)).href)));
const commands = modules.map((m) => m.data.toJSON());

const rest = new REST().setToken(config.discord.token);

try {
  console.log(`Registering ${commands.length} slash commands to guild ${config.discord.guildId}...`);
  const data = await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    { body: commands },
  );
  console.log(`Successfully registered ${data.length} commands.`);
} catch (err) {
  console.error(err);
}
