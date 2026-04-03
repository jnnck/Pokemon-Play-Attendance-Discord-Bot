import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import {
  getRegistrationByDiscordId,
  getRecentAttendanceCounts,
  getRecentMonths,
  getPlayerAttendanceHistory,
} from '../database.js';
import { qualifiesForRole, WINDOW } from '../tasks/roleSync.js';

export const data = new SlashCommandBuilder()
  .setName('attendance')
  .setDescription('Check attendance history for yourself or another player')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('Discord user to check (defaults to yourself)').setRequired(false)
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const isSelf = target.id === interaction.user.id;

  const registration = await getRegistrationByDiscordId(target.id);

  if (!registration) {
    const msg = isSelf
      ? "You haven't registered your player ID yet. Use `/register` to link your account."
      : `<@${target.id}> hasn't registered their player ID.`;
    return interaction.reply({ content: msg, ephemeral: true });
  }

  const recentMonths = await getRecentMonths(WINDOW);
  const countMap = await getRecentAttendanceCounts(WINDOW);
  const recentCount = countMap.get(target.id) ?? 0;
  const qualifies = qualifiesForRole(recentCount);

  const history = await getPlayerAttendanceHistory(registration.player_id, 10);

  const statusEmoji = qualifies ? '✅' : '❌';
  const roleStatus = `${statusEmoji} Active in **${recentCount}/${recentMonths.length}** recent month${recentMonths.length !== 1 ? 's' : ''}${
    qualifies ? ' — has attendance role' : ' — does not qualify for attendance role'
  }`;

  const historyLines =
    history.length > 0
      ? history.map((t) => `• ${t.date} — ${t.name}`).join('\n')
      : 'No tournament attendance recorded.';

  const embed = new EmbedBuilder()
    .setTitle(`Attendance: ${target.username}`)
    .setThumbnail(target.displayAvatarURL())
    .setColor(qualifies ? 0x2ecc71 : 0xe74c3c)
    .addFields(
      { name: 'Player ID', value: registration.player_id, inline: true },
      { name: 'Total events', value: String(history.length), inline: true },
      { name: 'Attendance role status', value: roleStatus },
      { name: 'Recent history (last 10)', value: historyLines },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], ephemeral: isSelf });
}
