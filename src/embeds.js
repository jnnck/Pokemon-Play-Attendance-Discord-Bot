import { EmbedBuilder } from 'discord.js';

const MEDALS = ['🥇', '🥈', '🥉'];
const CATEGORY_COLORS = { '2': 0xe74c3c, '1': 0x3498db, '0': 0x2ecc71 };

export function buildLeaderboardEmbed(players) {
  const lines = players.map((p, i) => {
    const prefix = MEDALS[i] ?? `**${i + 1}.**`;
    const name = p.discord_id ? `<@${p.discord_id}>` : p.player_name;
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
    const formatName = (p) => {
      const discordId = discordMap.get(p.player_id);
      return discordId ? `${p.player_name} (<@${discordId}>)` : p.player_name;
    };

    const lines = pod.finished.map((p) => {
      const prefix = MEDALS[p.place - 1] ?? `**${p.place}.**`;
      return `${prefix} ${formatName(p)}`;
    });

    if (pod.dnf.length > 0) {
      lines.push('', '*Did not finish:*');
      for (const p of pod.dnf) lines.push(`• ${formatName(p)}`);
    }

    return new EmbedBuilder()
      .setTitle(pod.label)
      .setColor(CATEGORY_COLORS[pod.category] ?? 0x95a5a6)
      .setDescription(lines.join('\n') || '*No results*');
  });

  return [header, ...categoryEmbeds];
}
