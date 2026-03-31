import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getAllTournaments, getAttendanceCountForTournament } from '../database.js';

export const data = new SlashCommandBuilder()
  .setName('tournaments')
  .setDescription('List all recorded tournaments');

export async function execute(interaction) {
  const tournaments = getAllTournaments();

  if (tournaments.length === 0) {
    return interaction.reply({ content: 'No tournaments have been uploaded yet.', ephemeral: true });
  }

  const lines = tournaments.map((t) => {
    const playerCount = getAttendanceCountForTournament(t.id);
    return `\`#${t.id}\` **${t.name}** — ${t.date} (${playerCount} players)`;
  });

  const embed = new EmbedBuilder()
    .setTitle('Recorded Tournaments')
    .setColor(0x3498db)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${tournaments.length} tournament${tournaments.length !== 1 ? 's' : ''} total` });

  await interaction.reply({ embeds: [embed] });
}
