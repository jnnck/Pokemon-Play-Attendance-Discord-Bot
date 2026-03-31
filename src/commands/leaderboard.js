import { SlashCommandBuilder } from 'discord.js';
import { getTopPlayers } from '../database.js';
import { buildLeaderboardEmbed } from '../embeds.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Show the all-time top 10 most active tournament players');

export async function execute(interaction) {
  const top10 = getTopPlayers(10);

  if (top10.length === 0) {
    return interaction.reply({ content: 'No tournament data yet. Upload a TDF file first.', ephemeral: true });
  }

  await interaction.reply({ embeds: [buildLeaderboardEmbed(top10)] });
}
