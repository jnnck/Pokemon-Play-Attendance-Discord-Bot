import { getRecentAttendanceCounts, getTournamentCount } from '../database.js';

export const REQUIRED_MONTHS = 2; // must have attended at least 1 event in this many months
export const WINDOW = 3;          // number of recent months to look back

export const qualifiesForRole = (monthCount) => monthCount >= REQUIRED_MONTHS;

/**
 * Assign or remove the attendance role for all registered players based on
 * whether they attended at least REQUIRED_EVENTS of the last WINDOW tournaments.
 *
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ added: number, removed: number }>}
 */
export async function syncAttendanceRoles(guild) {
  const roleId = process.env.ATTENDANCE_ROLE_ID;
  if (!roleId) {
    console.warn('[roleSync] ATTENDANCE_ROLE_ID not set — skipping role sync.');
    return { added: 0, removed: 0 };
  }

  const role = guild.roles.cache.get(roleId);
  if (!role) {
    console.warn(`[roleSync] Role ${roleId} not found in guild — skipping.`);
    return { added: 0, removed: 0 };
  }

  // Need at least 1 tournament on record before syncing roles
  if (getTournamentCount() === 0) return { added: 0, removed: 0 };

  const countMap = getRecentAttendanceCounts(WINDOW);
  if (countMap.size === 0) return { added: 0, removed: 0 };

  const discordIds = [...countMap.keys()];

  // Batch-fetch all members at once to avoid rate limiting
  let memberMap;
  try {
    memberMap = await guild.members.fetch({ user: discordIds });
  } catch {
    // Partial failure — fall back to individual fetches
    memberMap = new Map();
    for (const id of discordIds) {
      try {
        const member = await guild.members.fetch(id);
        memberMap.set(id, member);
      } catch {
        // Member left the server — skip silently
      }
    }
  }

  const added = [];
  const removed = [];

  for (const [discordId, recentCount] of countMap) {
    const member = memberMap.get(discordId);
    if (!member) continue; // Not in server

    const qualifies = qualifiesForRole(recentCount);
    const hasRole = member.roles.cache.has(roleId);

    try {
      if (qualifies && !hasRole) {
        await member.roles.add(role, 'Attended at least 1 event in 2 of the last 3 months');
        added.push(discordId);
      } else if (!qualifies && hasRole) {
        await member.roles.remove(role, 'Did not attend at least 1 event in 2 of the last 3 months');
        removed.push(discordId);
      }
    } catch (err) {
      console.error(`[roleSync] Failed to update role for ${discordId}: ${err.message}`);
    }
  }

  console.log(`[roleSync] Done: +${added.length} / -${removed.length} role changes`);
  return { added, removed };
}
