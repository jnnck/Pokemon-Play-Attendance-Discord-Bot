import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getTournamentById, deleteTournament, getAttendanceCountForTournament } from '../database.js';
import { syncAttendanceRoles } from '../tasks/roleSync.js';

export const data = new SlashCommandBuilder()
  .setName('tournament-delete')
  .setDescription('Delete a recorded tournament and its attendance data')
  .addIntegerOption((opt) =>
    opt
      .setName('id')
      .setDescription('Tournament ID (use /tournaments to find it)')
      .setRequired(true)
      .setMinValue(1)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const id = interaction.options.getInteger('id');

  const tournament = await getTournamentById(id);
  if (!tournament) {
    return interaction.reply({ content: `No tournament found with ID \`#${id}\`.`, ephemeral: true });
  }

  const playerCount = await getAttendanceCountForTournament(id);

  await deleteTournament(id);

  // Re-sync roles since the last 3 tournaments may have changed
  await syncAttendanceRoles(interaction.guild);

  const embed = new EmbedBuilder()
    .setTitle('Tournament Deleted')
    .setColor(0xe74c3c)
    .addFields(
      { name: 'Tournament', value: tournament.name, inline: true },
      { name: 'Date', value: tournament.date, inline: true },
      { name: 'Players removed', value: String(playerCount), inline: true },
    )
    .setFooter({ text: 'Attendance roles have been re-synced.' });

  await interaction.reply({ embeds: [embed] });
}
