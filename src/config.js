import 'dotenv/config';

function get(name, fallback) {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export const config = {
  discord: {
    token: get('DISCORD_TOKEN'),
    clientId: get('CLIENT_ID'),
    guildId: get('GUILD_ID'),
    attendanceRoleId: get('ATTENDANCE_ROLE_ID'),
    resultsChannelId: get('RESULTS_CHANNEL_ID'),
    eventsChannelId: get('EVENTS_CHANNEL_ID'),
  },
  db: {
    host: get('DB_HOST', 'localhost'),
    port: Number(get('DB_PORT', '3306')),
    user: get('DB_USER', 'tcgbot'),
    password: get('DB_PASSWORD', ''),
    database: get('DB_NAME', 'tcgbot'),
  },
  events: {
    latitude: get('POKEMON_EVENT_LAT'),
    longitude: get('POKEMON_EVENT_LON'),
    radius: get('POKEMON_EVENT_RADIUS', '10'),
    country: get('POKEMON_EVENT_COUNTRY', 'BE'),
    shop: get('POKEMON_EVENT_SHOP', ''),
    timezone: get('POKEMON_EVENT_TIMEZONE', 'Europe/Brussels'),
    pollIntervalMs: 60_000,
  },
};

export function assertBotConfig() {
  if (!config.discord.token) {
    throw new Error('Missing DISCORD_TOKEN in environment. Copy .env.example to .env and fill in your values.');
  }
}

export function assertDeployConfig() {
  const missing = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'].filter((name) => !get(name));
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')} in .env (required for deploy-commands).`);
  }
}

export function eventPollingEnabled() {
  return Boolean(config.events.latitude && config.events.longitude && config.discord.eventsChannelId);
}
