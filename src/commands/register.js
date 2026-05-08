import { SlashCommandBuilder } from 'discord.js';
import {
  getRegistrationByDiscordId,
  getRegistrationByPlayerId,
  upsertRegistration,
  getRecentAttendanceCounts,
  getRecentMonths,
} from '../database.js';
import { syncAttendanceRoles, qualifiesForRole, REQUIRED_MONTHS, WINDOW } from '../tasks/roleSync.js';
import { M } from '../messages.js';

export const data = new SlashCommandBuilder()
  .setName('register')
  .setDescription(M.commands.register.description)
  .addStringOption((opt) =>
    opt
      .setName('player_id')
      .setDescription(M.commands.register.playerIdOptionDescription)
      .setRequired(true)
  );

export async function execute(interaction) {
  const playerId = interaction.options.getString('player_id').trim();
  const discordId = interaction.user.id;

  // Check if this player ID is already taken by another Discord user
  const existingByPlayer = await getRegistrationByPlayerId(playerId);
  if (existingByPlayer && existingByPlayer.discord_id !== discordId) {
    return interaction.reply({
      content: M.commands.register.playerIdTaken(playerId),
      ephemeral: true,
    });
  }

  const existingByDiscord = await getRegistrationByDiscordId(discordId);
  const isUpdate = !!existingByDiscord;

  await upsertRegistration(discordId, playerId);

  // Check role eligibility immediately after registering
  await syncAttendanceRoles(interaction.guild);

  const countMap = await getRecentAttendanceCounts(WINDOW);
  const recentCount = countMap.get(discordId) ?? 0;
  const recentMonths = await getRecentMonths(WINDOW);
  const qualifies = qualifiesForRole(recentCount);

  const statusLine =
    recentMonths.length === 0
      ? M.commands.register.noTournaments
      : M.commands.register.statusLine(recentCount, recentMonths.length, qualifies, REQUIRED_MONTHS, WINDOW);

  const action = isUpdate
    ? M.commands.register.updated(existingByDiscord.player_id, playerId)
    : M.commands.register.registered(playerId);

  await interaction.reply({
    content: `${action}\n\n${statusLine}\n\n*${M.commands.register.hint}*`,
    ephemeral: true,
  });
}
