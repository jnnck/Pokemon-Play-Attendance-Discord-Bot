import mysql from 'mysql2/promise';
import { log } from './logger.js';

let pool;

export function isStacksEnabled() {
  return Boolean(process.env.STACKS_DB_NAME);
}

export async function initStacksDb() {
  if (!isStacksEnabled()) {
    log.info('[stacksDb] STACKS_DB_NAME not set; subscription feature disabled.');
    return;
  }

  pool = mysql.createPool({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'tcgbot',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.STACKS_DB_NAME,
    waitForConnections: true,
    connectionLimit: 5,
    dateStrings: true,
  });

  // Smoke-test the connection so we fail loudly at boot, not on first query.
  const conn = await pool.getConnection();
  try {
    await conn.query('SELECT 1');
    log.info(`[stacksDb] Connected to ${process.env.STACKS_DB_NAME}.`);
  } finally {
    conn.release();
  }
}

// --- Events ---

export async function getOpenUnpostedEvents() {
  const [rows] = await pool.execute(
    `SELECT id, name, slug, date_time, price, max_spots
     FROM events
     WHERE registrations_open = 1
       AND posted_to_discord = 0
       AND deleted_at IS NULL
     ORDER BY date_time ASC`
  );
  return rows;
}

export async function markEventPostedToDiscord(eventId) {
  await pool.execute(
    `UPDATE events SET posted_to_discord = 1, updated_at = NOW() WHERE id = ?`,
    [eventId]
  );
}

export async function getEventById(eventId) {
  const [rows] = await pool.execute(
    `SELECT id, name, slug, date_time, price, max_spots
     FROM events
     WHERE id = ? AND deleted_at IS NULL`,
    [eventId]
  );
  return rows[0] ?? null;
}

export async function getActiveReservationCount(eventId) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS active_count
     FROM reservations
     WHERE event_id = ? AND status IN ('unconfirmed', 'confirmed')`,
    [eventId]
  );
  return Number(rows[0].active_count);
}

/**
 * Events that are still open for registration, posted, upcoming,
 * and not soft-deleted. Used to refresh the live spot count.
 */
export async function getOpenPostedUpcomingEvents() {
  const [rows] = await pool.execute(
    `SELECT id, name, slug, date_time, price, max_spots
     FROM events
     WHERE registrations_open = 1
       AND posted_to_discord = 1
       AND deleted_at IS NULL
       AND date_time > NOW()
     ORDER BY date_time ASC`
  );
  return rows;
}

// --- Players ---

export async function getPlayerByDiscordId(discordId) {
  const [rows] = await pool.execute(
    `SELECT id, first_name, last_name, player_id, discord_id, discord_username
     FROM players
     WHERE discord_id = ? AND deleted_at IS NULL`,
    [discordId]
  );
  return rows[0] ?? null;
}

export async function getPlayerByPlayerId(playerId) {
  const [rows] = await pool.execute(
    `SELECT id, discord_id
     FROM players
     WHERE player_id = ? AND deleted_at IS NULL`,
    [playerId]
  );
  return rows[0] ?? null;
}

export async function createPlayer({ firstName, lastName, playerId, discordId, discordUsername }) {
  const [result] = await pool.execute(
    `INSERT INTO players
       (first_name, last_name, player_id, discord_id, discord_username, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [firstName, lastName, playerId, discordId, discordUsername]
  );
  return result.insertId;
}

// --- Reservations ---

/**
 * Atomically check capacity and insert a reservation.
 * Returns { status: 'confirmed' | 'waitlist' | 'duplicate', reservationId: number | null }.
 *
 * - Locks the event row to prevent over-capacity races.
 * - If the player already has an active reservation, returns { status: 'duplicate' }
 *   (caught via the `uniq_active_event_player` constraint).
 */
export async function createReservationForPlayer(eventId, playerId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [eventRows] = await conn.execute(
      `SELECT max_spots FROM events WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [eventId]
    );
    if (eventRows.length === 0) {
      await conn.rollback();
      throw new Error(`Event ${eventId} not found`);
    }
    const maxSpots = eventRows[0].max_spots;

    const [countRows] = await conn.execute(
      `SELECT COUNT(*) AS active_count
       FROM reservations
       WHERE event_id = ? AND status IN ('unconfirmed', 'confirmed')`,
      [eventId]
    );
    const activeCount = Number(countRows[0].active_count);
    const status = activeCount >= maxSpots ? 'waitlist' : 'confirmed';

    let reservationId;
    try {
      const [insert] = await conn.execute(
        `INSERT INTO reservations
           (event_id, player_id, status, paid, created_at, updated_at)
         VALUES (?, ?, ?, 0, NOW(), NOW())`,
        [eventId, playerId, status]
      );
      reservationId = insert.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        await conn.rollback();
        return { status: 'duplicate', reservationId: null };
      }
      throw err;
    }

    await conn.commit();
    return { status, reservationId };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}
