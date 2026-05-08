import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import {
  getRegistrationByDiscordId,
  getRecentAttendanceCounts,
  getRecentMonths,
  getPlayerAttendanceHistory,
} from '../database.js';
import { qualifiesForRole, WINDOW } from '../tasks/roleSync.js';
import { M } from '../messages.js';

export const data = new SlashCommandBuilder()
  .setName('attendance')
  .setDescription(M.commands.attendance.description)
  .addUserOption((opt) =>
    opt.setName('user').setDescription(M.commands.attendance.userOptionDescription).setRequired(false)
  );

export async function execute(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  const isSelf = target.id === interaction.user.id;

  const registration = await getRegistrationByDiscordId(target.id);

  if (!registration) {
    const msg = isSelf
      ? M.commands.attendance.notRegisteredSelf
      : M.commands.attendance.notRegisteredOther(target.id);
    return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  }

  const recentMonths = await getRecentMonths(WINDOW);
  const countMap = await getRecentAttendanceCounts(WINDOW);
  const recentCount = countMap.get(target.id) ?? 0;
  const qualifies = qualifiesForRole(recentCount);

  const history = await getPlayerAttendanceHistory(registration.player_id, 10);

  const statusEmoji = qualifies ? '✅' : '❌';
  const roleStatus = M.commands.attendance.roleStatusLine(statusEmoji, recentCount, recentMonths.length, qualifies);

  const historyLines =
    history.length > 0
      ? history.map((t) => `• ${t.date} — ${t.name}`).join('\n')
      : M.commands.attendance.noHistory;

  const embed = new EmbedBuilder()
    .setTitle(M.commands.attendance.embedTitle(target.username))
    .setThumbnail(target.displayAvatarURL())
    .setColor(qualifies ? 0x2ecc71 : 0xe74c3c)
    .addFields(
      { name: M.commands.attendance.fieldPlayerId, value: registration.player_id, inline: true },
      { name: M.commands.attendance.fieldTotalEvents, value: String(history.length), inline: true },
      { name: M.commands.attendance.fieldRoleStatus, value: roleStatus },
      { name: M.commands.attendance.fieldRecentHistory, value: historyLines },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: isSelf ? MessageFlags.Ephemeral : 0 });
}
