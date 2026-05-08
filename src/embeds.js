import { EmbedBuilder } from 'discord.js';

const MEDALS = ['🥇', '🥈', '🥉'];
const CATEGORY_COLORS = { '2': 0xe74c3c, '1': 0x3498db, '0': 0x2ecc71 };
const EVENT_COLORS = {
  'League Challenge': 0xe67e22,
  'League Cup': 0x9b59b6,
  'nonpremier TCG': 0x3498db,
  'Prerelease': 0x2ecc71,
};

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

export function buildEventEmbed(event) {
  const color = EVENT_COLORS[event.type] ?? 0x95a5a6;

  const embed = new EmbedBuilder()
    .setTitle(event.title || event.type || 'Pokémon Event')
    .setColor(color)
    .addFields(
      { name: 'Date', value: event.date, inline: true },
      { name: 'Time', value: event.time || 'TBD', inline: true },
    );

  if (event.type) embed.addFields({ name: 'Type', value: event.type, inline: true });
  if (event.store) embed.addFields({ name: 'Store', value: event.store, inline: true });
  if (event.location) embed.addFields({ name: 'Location', value: event.location, inline: true });
  if (event.link) embed.setURL(event.link);

  return embed;
}

export function buildUpcomingEventsEmbed(events) {
  const lines = events.map((e) => {
    const time = e.time ? ` ${e.time}` : '';
    const link = e.link ? ` — [details](${e.link})` : '';
    return `**${e.date}${time}** — ${e.title}${e.store ? ` @ ${e.store}` : ''}${link}`;
  });

  return new EmbedBuilder()
    .setTitle('Upcoming Events')
    .setColor(0x3498db)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${events.length} event${events.length !== 1 ? 's' : ''} found` })
    .setTimestamp();
}
