import { EmbedBuilder, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel } from 'discord.js';
import { upsertEvent, getUnpostedEvents, markEventPosted } from '../database.js';
import { log } from '../logger.js';

const API_URL = 'https://www.pokedata.ovh/events/tableapi/index_table.php';

const EVENT_COLORS = {
  'League Challenge': 0xe67e22,
  'League Cup': 0x9b59b6,
  'nonpremier TCG': 0x3498db,
  'Prerelease': 0x2ecc71,
};

/**
 * Fetch all upcoming events from pokedata.ovh for the configured location.
 */
async function fetchAllEvents() {
  const latitude = process.env.POKEMON_EVENT_LAT;
  const longitude = process.env.POKEMON_EVENT_LON;
  const radius = process.env.POKEMON_EVENT_RADIUS ?? '10';
  const country = process.env.POKEMON_EVENT_COUNTRY ?? 'BE';
  const shop = process.env.POKEMON_EVENT_SHOP ?? '';

  if (!latitude || !longitude) {
    return [];
  }

  const allEvents = [];

  for (let page = 0; ; page++) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json; charset=UTF-8',
        'origin': 'https://www.pokedata.ovh',
        'referer': 'https://www.pokedata.ovh/events/',
        'user-agent': 'Mozilla/5.0 (compatible)',
      },
      body: JSON.stringify({
        past: '1', country, city: '', shop, league: '', states: '[]',
        postcode: '', cups: '1', challenges: '1', vcups: '', vchallenges: '',
        prereleases: '1', premier: '', go: '', gocup: '', mss: '', ftcg: '',
        fvg: '', fgo: '', latitude, longitude, radius, unit: 'km',
        width: 1280, page,
      }),
    });

    if (!res.ok) {
      log.warn(`[eventFetcher] API returned ${res.status} on page ${page}`);
      break;
    }

    const events = await res.json();
    if (!Array.isArray(events) || events.length === 0) break;

    allEvents.push(...events);
  }

  if (shop) {
    const needle = shop.toLowerCase();
    const kept = [];
    const droppedShops = new Set();
    for (const e of allEvents) {
      if ((e.shop ?? '').toLowerCase() === needle) {
        kept.push(e);
      } else {
        droppedShops.add(e.shop ?? '(empty)');
      }
    }
    if (droppedShops.size > 0) {
      log.info(`[eventFetcher] Filtered out ${allEvents.length - kept.length} event(s); shops seen: ${[...droppedShops].join(', ')}`);
    }
    return kept;
  }

  return allEvents;
}

/**
 * Map a structured API response to our DB event format.
 */
function toEvent(raw) {
  const timeMatch = raw.when?.match(/\d{2}:\d{2}/);

  return {
    guid: raw.guid,
    type: raw.type ?? '',
    title: raw.name || raw.type || 'Pokémon Event',
    date: raw.date ?? '',
    time: timeMatch?.[0] ?? '',
    store: raw.shop ?? '',
    location: [raw.city, raw.state].filter(Boolean).join(', '),
    link: raw.pokemon_url ?? '',
  };
}

/**
 * Fetch events, store new ones, and post unposted events to the channel.
 * @param {import('discord.js').Client} client
 */
export async function pollEvents(client) {
  const channelId = process.env.EVENTS_CHANNEL_ID;
  if (!channelId) return;

  if (!process.env.POKEMON_EVENT_LAT || !process.env.POKEMON_EVENT_LON) {
    return;
  }

  try {
    const rawEvents = await fetchAllEvents();
    for (const raw of rawEvents) {
      const event = toEvent(raw);
      if (event.date) await upsertEvent(event);
    }

    const today = new Date().toISOString().split('T')[0];
    const shopFilter = (process.env.POKEMON_EVENT_SHOP ?? '').toLowerCase();
    const unposted = (await getUnpostedEvents()).filter((e) => {
      if (e.date < today) return false;
      if (shopFilter && (e.store ?? '').toLowerCase() !== shopFilter) return false;
      return true;
    });
    if (unposted.length === 0) return;

    const channel = client.channels.cache.get(channelId);
    if (!channel?.isTextBased()) {
      log.warn(`[eventFetcher] EVENTS_CHANNEL_ID ${channelId} not found or not a text channel.`);
      return;
    }

    const guild = client.guilds.cache.get(process.env.GUILD_ID);

    for (const event of unposted) {
      const embed = buildEventEmbed(event);
      await channel.send({ embeds: [embed] });

      let discordEventId = null;
      if (guild) {
        discordEventId = await createDiscordEvent(guild, event);
      }

      await markEventPosted(event.guid, discordEventId);
      log.info(`[eventFetcher] Posted new event: ${event.title} (${event.date})${discordEventId ? ' (scheduled event created)' : ''}`);
    }
  } catch (err) {
    log.error('[eventFetcher] Failed to poll events:', err);
  }
}

/**
 * Create a Discord scheduled event for an upcoming event.
 * Returns the Discord event ID, or null on failure.
 */
async function createDiscordEvent(guild, event) {
  try {
    const scheduledStartAt = parseEventDate(event.date, event.time);
    if (!scheduledStartAt || scheduledStartAt <= new Date()) return null;

    // End time defaults to 3 hours after start
    const scheduledEndAt = new Date(scheduledStartAt.getTime() + 3 * 60 * 60 * 1000);

    const locationParts = [event.store, event.location].filter(Boolean);
    const entityMetadataLocation = locationParts.join(', ') || 'TBD';

    const description = [
      event.type ? `Type: ${event.type}` : '',
      event.link ? `Details: ${event.link}` : '',
    ].filter(Boolean).join('\n');

    const discordEvent = await guild.scheduledEvents.create({
      name: event.title,
      scheduledStartTime: scheduledStartAt,
      scheduledEndTime: scheduledEndAt,
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: GuildScheduledEventEntityType.External,
      entityMetadata: { location: entityMetadataLocation },
      description: description || undefined,
    });

    return discordEvent.id;
  } catch (err) {
    log.error(`[eventFetcher] Failed to create Discord event for "${event.title}":`, err);
    return null;
  }
}

/**
 * Parse event date (YYYY-MM-DD) and optional time (HH:MM) into a UTC Date.
 * Treats the input as local time in the configured timezone (default: Europe/Brussels).
 */
function parseEventDate(dateStr, timeStr) {
  if (!dateStr) return null;
  const tz = process.env.POKEMON_EVENT_TIMEZONE ?? 'Europe/Brussels';
  const time = timeStr || '12:00';
  const naive = new Date(`${dateStr}T${time}:00Z`);
  const inLocal = new Date(naive.toLocaleString('en-US', { timeZone: tz }));
  const inUTC = new Date(naive.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(naive.getTime() - (inLocal - inUTC));
}

function buildEventEmbed(event) {
  const color = EVENT_COLORS[event.type] ?? 0x95a5a6;

  const embed = new EmbedBuilder()
    .setTitle(event.title || event.type || 'Pokémon Event')
    .setColor(color)
    .addFields(
      { name: 'Date', value: event.date, inline: true },
      { name: 'Time', value: event.time || 'TBD', inline: true },
    );

  if (event.type) {
    embed.addFields({ name: 'Type', value: event.type, inline: true });
  }
  if (event.store) {
    embed.addFields({ name: 'Store', value: event.store, inline: true });
  }
  if (event.location) {
    embed.addFields({ name: 'Location', value: event.location, inline: true });
  }
  if (event.link) {
    embed.setURL(event.link);
  }

  return embed;
}
