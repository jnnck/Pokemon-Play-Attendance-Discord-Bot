import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getTopPlayers } from '../database.js';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Show the all-time top 10 most active tournament players');

export async function execute(interaction) {
  const top10 = getTopPlayers(10);

  if (top10.length === 0) {
    return interaction.reply({ content: 'No tournament data yet. Upload a TDF file first.', ephemeral: true });
  }

  const embed = buildLeaderboardEmbed(top10);
  await interaction.reply({ embeds: [embed] });
}

function buildLeaderboardEmbed(players) {
  const medals = ['🥇', '🥈', '🥉'];

  const lines = players.map((p, i) => {
    const prefix = medals[i] ?? `**${i + 1}.**`;
    const name = p.discord_id ? `<@${p.discord_id}>` : p.player_name;
    return `${prefix} ${name} — ${p.events_attended} event${p.events_attended !== 1 ? 's' : ''}`;
  });

  return new EmbedBuilder()
    .setTitle('All-Time Top 10 Most Active Players')
    .setColor(0xf1c40f)
    .setDescription(lines.join('\n'))
    .setTimestamp();
}
