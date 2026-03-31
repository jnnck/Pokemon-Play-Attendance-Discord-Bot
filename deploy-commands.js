import 'dotenv/config';
import { REST, Routes } from 'discord.js';

import * as uploadCommand from './src/commands/upload.js';
import * as registerCommand from './src/commands/register.js';
import * as leaderboardCommand from './src/commands/leaderboard.js';
import * as attendanceCommand from './src/commands/attendance.js';
import * as tournamentsCommand from './src/commands/tournaments.js';
import * as tournamentDeleteCommand from './src/commands/tournament-delete.js';

const commands = [
  uploadCommand,
  registerCommand,
  leaderboardCommand,
  attendanceCommand,
  tournamentsCommand,
  tournamentDeleteCommand,
].map((cmd) => cmd.data.toJSON());

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN, CLIENT_ID, or GUILD_ID in .env');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);

try {
  console.log(`Registering ${commands.length} slash commands to guild ${GUILD_ID}...`);
  const data = await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log(`Successfully registered ${data.length} commands.`);
} catch (err) {
  console.error(err);
}
