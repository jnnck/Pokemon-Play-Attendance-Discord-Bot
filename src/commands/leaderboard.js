import { SlashCommandBuilder } from 'discord.js';
import { getTopPlayers } from '../database.js';
import { buildLeaderboardEmbed } from '../embeds.js';
import { M } from '../messages.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription(M.commands.leaderboard.description);

export async function execute(interaction) {
  const top10 = await getTopPlayers(10);

  if (top10.length === 0) {
    return interaction.reply({ content: M.commands.leaderboard.noData, ephemeral: true });
  }

  await interaction.reply({ embeds: [buildLeaderboardEmbed(top10)] });
}
