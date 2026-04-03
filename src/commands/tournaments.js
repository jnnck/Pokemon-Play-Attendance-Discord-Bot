import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getAllTournaments, getAttendanceCountForTournament } from '../database.js';

export const data = new SlashCommandBuilder()
  .setName('tournaments')
  .setDescription('List all recorded tournaments');

export async function execute(interaction) {
  const tournaments = await getAllTournaments();

  if (tournaments.length === 0) {
    return interaction.reply({ content: 'No tournaments have been uploaded yet.', ephemeral: true });
  }

  const lines = [];
  for (const t of tournaments) {
    const playerCount = await getAttendanceCountForTournament(t.id);
    lines.push(`\`#${t.id}\` **${t.name}** — ${t.date} (${playerCount} players)`);
  }

  const embed = new EmbedBuilder()
    .setTitle('Recorded Tournaments')
    .setColor(0x3498db)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${tournaments.length} tournament${tournaments.length !== 1 ? 's' : ''} total` });

  await interaction.reply({ embeds: [embed] });
}
