import { EmbedBuilder } from 'discord.js';

const MEDALS = ['🥇', '🥈', '🥉'];
const CATEGORY_COLORS = { '2': 0xe74c3c, '1': 0x3498db, '0': 0x2ecc71 };

/**
 * Format a player's name for public display: "Firstname L."
 */
export function formatName(first_name, last_name) {
  return last_name ? `${first_name} ${last_name.charAt(0)}.` : first_name;
}

export function buildLeaderboardEmbed(players) {
  const lines = players.map((p, i) => {
    const prefix = MEDALS[i] ?? `**${i + 1}.**`;
    const short = formatName(p.first_name, p.last_name);
    const name = p.discord_id ? `${short} (<@${p.discord_id}>)` : short;
    return `${prefix} ${name} — ${p.events_attended} event${p.events_attended !== 1 ? 's' : ''}`;
  });

  return new EmbedBuilder()
    .setTitle('All-Time Top 10 Most Active Players')
    .setColor(0xf1c40f)
    .setDescription(lines.length > 0 ? lines.join('\n') : 'No data yet.')
    .setTimestamp();
}

export function buildStandingsEmbeds(tournamentName, date, standings, discordMap = new Map()) {
  const header = new EmbedBuilder()
    .setTitle(`Results — ${tournamentName}`)
    .setDescription(date)
    .setColor(0x9b59b6)
    .setTimestamp();

  const categoryEmbeds = standings.map((pod) => {
    const displayName = (p) => {
      const discordId = discordMap.get(p.player_id);
      const short = formatName(p.first_name, p.last_name);
      return discordId ? `${short} (<@${discordId}>)` : short;
    };

    const lines = pod.finished.map((p) => {
      const prefix = MEDALS[p.place - 1] ?? `**${p.place}.**`;
      return `${prefix} ${displayName(p)}`;
    });

    if (pod.dnf.length > 0) {
      lines.push('', '*Did not finish:*');
      for (const p of pod.dnf) lines.push(`• ${displayName(p)}`);
    }

    return new EmbedBuilder()
      .setTitle(pod.label)
      .setColor(CATEGORY_COLORS[pod.category] ?? 0x95a5a6)
      .setDescription(lines.join('\n') || '*No results*');
  });

  return [header, ...categoryEmbeds];
}
