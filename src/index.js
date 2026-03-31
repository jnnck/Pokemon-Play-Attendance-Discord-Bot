import 'dotenv/config';
import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';

import * as uploadCommand from './commands/upload.js';
import * as registerCommand from './commands/register.js';
import * as leaderboardCommand from './commands/leaderboard.js';
import * as attendanceCommand from './commands/attendance.js';
import * as tournamentsCommand from './commands/tournaments.js';
import * as tournamentDeleteCommand from './commands/tournament-delete.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// Register commands in a collection
client.commands = new Collection();

for (const cmd of [uploadCommand, registerCommand, leaderboardCommand, attendanceCommand, tournamentsCommand, tournamentDeleteCommand]) {
  client.commands.set(cmd.data.name, cmd);
}

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  console.log(`Serving ${c.guilds.cache.size} guild(s)`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error executing /${interaction.commandName}:`, err);

    const payload = { content: 'Something went wrong. Please try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN in environment. Copy .env.example to .env and fill in your values.');
  process.exit(1);
}

client.login(token);
