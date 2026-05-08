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
 * Returns the active reservation row for (event, player), or null.
 * "Active" means status in unconfirmed/confirmed/waitlist.
 */
export async function getActiveReservation(eventId, playerId) {
  const [rows] = await pool.execute(
    `SELECT id, status FROM reservations
     WHERE event_id = ? AND player_id = ?
       AND status IN ('unconfirmed', 'confirmed', 'waitlist')
     LIMIT 1`,
    [eventId, playerId]
  );
  return rows[0] ?? null;
}

/**
 * Cancel any active reservation for (event, player). Returns true if a row
 * was updated. No-op if the player has no active reservation.
 */
export async function cancelActiveReservation(eventId, playerId) {
  const [result] = await pool.execute(
    `UPDATE reservations
     SET status = 'cancelled', updated_at = NOW()
     WHERE event_id = ? AND player_id = ?
       AND status IN ('unconfirmed', 'confirmed', 'waitlist')`,
    [eventId, playerId]
  );
  return result.affectedRows > 0;
}

/**
 * Atomically check capacity and create or reuse a reservation.
 *
 * Returns { status: 'confirmed' | 'waitlist' | 'duplicate', reservationId: number | null }.
 *
 * - Locks the event row to prevent over-capacity races.
 * - If a cancelled reservation exists for (event, player), reuses it by flipping
 *   its status; this implements the "re-register after unregister is just a status
 *   change" behaviour.
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

    // Reuse the most recent cancelled reservation for this (event, player) if one exists.
    const [cancelledRows] = await conn.execute(
      `SELECT id FROM reservations
       WHERE event_id = ? AND player_id = ? AND status = 'cancelled'
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [eventId, playerId]
    );

    let reservationId;
    if (cancelledRows.length > 0) {
      reservationId = cancelledRows[0].id;
      await conn.execute(
        `UPDATE reservations SET status = ?, updated_at = NOW() WHERE id = ?`,
        [status, reservationId]
      );
    } else {
      try {
        const [insert] = await conn.execute(
          `INSERT INTO reservations
             (event_id, player_id, status, source, paid, created_at, updated_at)
           VALUES (?, ?, ?, 'discord', 0, NOW(), NOW())`,
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
