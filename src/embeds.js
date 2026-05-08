import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { M, statusLabel, sourceLabel } from './messages.js';

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
    return M.leaderboardEmbed.line(prefix, name, p.events_attended);
  });

  return new EmbedBuilder()
    .setTitle(M.leaderboardEmbed.title)
    .setColor(0xf1c40f)
    .setDescription(lines.length > 0 ? lines.join('\n') : M.leaderboardEmbed.empty)
    .setTimestamp();
}

export function buildStandingsEmbeds(tournamentName, date, standings, discordMap = new Map()) {
  const header = new EmbedBuilder()
    .setTitle(M.standingsEmbed.title(tournamentName))
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
      lines.push('', M.standingsEmbed.didNotFinish);
      for (const p of pod.dnf) lines.push(`• ${displayName(p)}`);
    }

    return new EmbedBuilder()
      .setTitle(pod.label)
      .setColor(CATEGORY_COLORS[pod.category] ?? 0x95a5a6)
      .setDescription(lines.join('\n') || M.standingsEmbed.noResults);
  });

  return [header, ...categoryEmbeds];
}

/**
 * Format a date_time string from MariaDB (e.g. "2026-05-15 19:00:00")
 * as a Discord timestamp using the long-date-with-time style.
 */
function formatEventDateTime(dateTimeStr) {
  const ts = Math.floor(new Date(dateTimeStr.replace(' ', 'T')).getTime() / 1000);
  return `<t:${ts}:F>`;
}

export function buildSubscribeEmbed(event, availableSpots) {
  const embed = new EmbedBuilder()
    .setTitle(event.name)
    .setColor(0x5865f2)
    .addFields({ name: M.subscribeEmbed.fieldWhen, value: formatEventDateTime(event.date_time), inline: false });

  const price = Number(event.price);
  if (price > 0) {
    embed.addFields({ name: M.subscribeEmbed.fieldPrice, value: `€${price.toFixed(2)}`, inline: true });
  }
  embed.addFields({ name: M.subscribeEmbed.fieldSpots, value: M.subscribeEmbed.spotsValue(availableSpots, event.max_spots), inline: true });
  embed.setFooter({ text: M.subscribeEmbed.footer });

  return embed;
}

export function buildSubscribeRow(eventId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stacks-sub:${eventId}`)
      .setLabel(M.buttons.register)
      .setStyle(ButtonStyle.Primary)
  );
}

const STATUS_COLORS = {
  confirmed:   0x2ecc71,
  waitlist:    0xf39c12,
  cancelled:   0xe74c3c,
  unconfirmed: 0x95a5a6,
};

function statusColor(status) {
  return STATUS_COLORS[status] ?? 0x95a5a6;
}

function reservationFooter(reservation) {
  return M.reservationEmbed.footer(reservation.id);
}

function reservationPlayerLine(reservation) {
  const id = reservation.player_external_id ? ` (${reservation.player_external_id})` : '';
  return `${reservation.first_name} ${reservation.last_name ?? ''}${id}`.trim();
}

export function buildNewReservationEmbed(reservation) {
  return new EmbedBuilder()
    .setTitle(M.reservationEmbed.newTitle(reservation.event_name))
    .setColor(statusColor(reservation.status))
    .addFields(
      { name: M.reservationEmbed.fieldPlayer, value: reservationPlayerLine(reservation), inline: false },
      { name: M.reservationEmbed.fieldStatus, value: statusLabel(reservation.status), inline: true },
      { name: M.reservationEmbed.fieldSource, value: sourceLabel(reservation.source), inline: true },
    )
    .setFooter({ text: reservationFooter(reservation) })
    .setTimestamp();
}

export function buildStatusChangeEmbed(reservation, oldStatus) {
  return new EmbedBuilder()
    .setTitle(M.reservationEmbed.updatedTitle(reservation.event_name))
    .setColor(statusColor(reservation.status))
    .addFields(
      { name: M.reservationEmbed.fieldPlayer, value: reservationPlayerLine(reservation), inline: false },
      { name: M.reservationEmbed.fieldStatus, value: M.reservationEmbed.statusTransition(statusLabel(oldStatus), statusLabel(reservation.status)), inline: true },
      { name: M.reservationEmbed.fieldSource, value: sourceLabel(reservation.source), inline: true },
    )
    .setFooter({ text: reservationFooter(reservation) })
    .setTimestamp();
}
