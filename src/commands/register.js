import { SlashCommandBuilder } from 'discord.js';
import {
  getRegistrationByDiscordId,
  getRegistrationByPlayerId,
  upsertRegistration,
  getRecentAttendanceCounts,
  getRecentMonths,
} from '../database.js';
import { syncAttendanceRoles, qualifiesForRole, REQUIRED_MONTHS, WINDOW } from '../tasks/roleSync.js';

export const data = new SlashCommandBuilder()
  .setName('register')
  .setDescription('Link your Discord account to your Pokemon TCG player ID')
  .addStringOption((opt) =>
    opt
      .setName('player_id')
      .setDescription('Your player ID as it appears in TDF tournament files')
      .setRequired(true)
  );

export async function execute(interaction) {
  const playerId = interaction.options.getString('player_id').trim();
  const discordId = interaction.user.id;

  // Check if this player ID is already taken by another Discord user
  const existingByPlayer = await getRegistrationByPlayerId(playerId);
  if (existingByPlayer && existingByPlayer.discord_id !== discordId) {
    return interaction.reply({
      content: `Player ID **${playerId}** is already registered to another Discord account.`,
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
      ? 'No tournaments have been uploaded yet.'
      : `You attended events in **${recentCount}** of the last **${recentMonths.length}** month${recentMonths.length !== 1 ? 's' : ''}${qualifies ? ' — you have the attendance role!' : ` — you need at least 1 event in ${REQUIRED_MONTHS} of the last ${WINDOW} months to earn the attendance role.`}`;

  const action = isUpdate
    ? `Updated your registration from **${existingByDiscord.player_id}** to **${playerId}**.`
    : `Registered player ID **${playerId}** to your account.`;

  await interaction.reply({
    content: `${action}\n\n${statusLine}\n\n*Your player ID can be found in official tournament result exports.*`,
    ephemeral: true,
  });
}
