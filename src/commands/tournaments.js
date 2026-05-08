import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getAllTournaments, getAttendanceCountForTournament } from '../database.js';
import { M } from '../messages.js';

export const data = new SlashCommandBuilder()
  .setName('tournaments')
  .setDescription(M.commands.tournaments.description);

export async function execute(interaction) {
  const tournaments = await getAllTournaments();

  if (tournaments.length === 0) {
    return interaction.reply({ content: M.commands.tournaments.noTournaments, ephemeral: true });
  }

  const lines = [];
  for (const t of tournaments) {
    const playerCount = await getAttendanceCountForTournament(t.id);
    lines.push(M.commands.tournaments.line(t.id, t.name, t.date, playerCount));
  }

  const embed = new EmbedBuilder()
    .setTitle(M.commands.tournaments.embedTitle)
    .setColor(0x3498db)
    .setDescription(lines.join('\n'))
    .setFooter({ text: M.commands.tournaments.footer(tournaments.length) });

  await interaction.reply({ embeds: [embed] });
}
