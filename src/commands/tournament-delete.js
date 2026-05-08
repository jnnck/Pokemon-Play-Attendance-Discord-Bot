import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getTournamentById, deleteTournament, getAttendanceCountForTournament } from '../database.js';
import { syncAttendanceRoles } from '../tasks/roleSync.js';
import { M } from '../messages.js';

export const data = new SlashCommandBuilder()
  .setName('tournament-delete')
  .setDescription(M.commands.tournamentDelete.description)
  .addIntegerOption((opt) =>
    opt
      .setName('id')
      .setDescription(M.commands.tournamentDelete.idOptionDescription)
      .setRequired(true)
      .setMinValue(1)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const id = interaction.options.getInteger('id');

  const tournament = await getTournamentById(id);
  if (!tournament) {
    return interaction.reply({ content: M.commands.tournamentDelete.notFound(id), ephemeral: true });
  }

  const playerCount = await getAttendanceCountForTournament(id);

  await deleteTournament(id);

  // Re-sync roles since the last 3 tournaments may have changed
  await syncAttendanceRoles(interaction.guild);

  const embed = new EmbedBuilder()
    .setTitle(M.commands.tournamentDelete.embedTitle)
    .setColor(0xe74c3c)
    .addFields(
      { name: M.commands.tournamentDelete.fieldTournament, value: tournament.name, inline: true },
      { name: M.commands.tournamentDelete.fieldDate, value: tournament.date, inline: true },
      { name: M.commands.tournamentDelete.fieldPlayersRemoved, value: String(playerCount), inline: true },
    )
    .setFooter({ text: M.commands.tournamentDelete.footer });

  await interaction.reply({ embeds: [embed] });
}
