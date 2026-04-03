import mysql from 'mysql2/promise';

let pool;

export async function initDatabase() {
  pool = mysql.createPool({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'tcgbot',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'tcgbot',
    waitForConnections: true,
    connectionLimit: 10,
  });

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      date        VARCHAR(20) NOT NULL,
      uploaded_at BIGINT NOT NULL,
      uploaded_by VARCHAR(64) NOT NULL
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS attendances (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      tournament_id INT NOT NULL,
      player_id     VARCHAR(64) NOT NULL,
      first_name    VARCHAR(255) NOT NULL,
      last_name     VARCHAR(255) NOT NULL DEFAULT '',
      INDEX idx_attendances_player_id (player_id),
      INDEX idx_attendances_tournament_id (tournament_id)
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS player_registrations (
      discord_id    VARCHAR(64) PRIMARY KEY,
      player_id     VARCHAR(64) NOT NULL UNIQUE,
      registered_at BIGINT NOT NULL
    )
  `);

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS events (
      guid              VARCHAR(255) PRIMARY KEY,
      type              VARCHAR(100) NOT NULL,
      title             VARCHAR(255) NOT NULL,
      date              VARCHAR(20) NOT NULL,
      time              VARCHAR(10) NOT NULL DEFAULT '',
      store             VARCHAR(255) NOT NULL DEFAULT '',
      location          VARCHAR(255) NOT NULL DEFAULT '',
      link              VARCHAR(512) NOT NULL DEFAULT '',
      posted            TINYINT NOT NULL DEFAULT 0,
      discord_event_id  VARCHAR(64)
    )
  `);
}

// --- Tournaments ---

export async function insertTournament({ name, date, uploadedBy }) {
  const [result] = await pool.execute(
    'INSERT INTO tournaments (name, date, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?)',
    [name, date, Date.now(), uploadedBy]
  );
  return result.insertId;
}

export async function getRecentTournamentIds(limit = 3) {
  const [rows] = await pool.execute(
    'SELECT id FROM tournaments ORDER BY uploaded_at DESC LIMIT ?',
    [limit]
  );
  return rows.map((r) => r.id);
}

export async function getTournamentCount() {
  const [rows] = await pool.execute('SELECT COUNT(*) as count FROM tournaments');
  return rows[0].count;
}

export async function getAllTournaments() {
  const [rows] = await pool.execute('SELECT * FROM tournaments ORDER BY uploaded_at DESC');
  return rows;
}

export async function getTournamentById(id) {
  const [rows] = await pool.execute('SELECT * FROM tournaments WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function deleteTournament(id) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('DELETE FROM attendances WHERE tournament_id = ?', [id]);
    await conn.execute('DELETE FROM tournaments WHERE id = ?', [id]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// --- Attendances ---

export async function insertAttendances(tournamentId, players) {
  if (players.length === 0) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const { player_id, first_name, last_name } of players) {
      await conn.execute(
        'INSERT INTO attendances (tournament_id, player_id, first_name, last_name) VALUES (?, ?, ?, ?)',
        [tournamentId, player_id, first_name, last_name ?? '']
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getAttendanceCountForTournament(tournamentId) {
  const [rows] = await pool.execute(
    'SELECT COUNT(*) as count FROM attendances WHERE tournament_id = ?',
    [tournamentId]
  );
  return rows[0].count;
}

// --- Leaderboard ---

export async function getTopPlayers(limit = 10) {
  const [rows] = await pool.execute(
    `SELECT
      a.first_name,
      a.last_name,
      a.player_id,
      pr.discord_id,
      COUNT(DISTINCT a.tournament_id) AS events_attended
    FROM attendances a
    LEFT JOIN player_registrations pr ON a.player_id = pr.player_id
    GROUP BY a.player_id
    ORDER BY events_attended DESC
    LIMIT ?`,
    [limit]
  );
  return rows;
}

// --- Player Registrations ---

export async function getRegistrationByDiscordId(discordId) {
  const [rows] = await pool.execute(
    'SELECT * FROM player_registrations WHERE discord_id = ?',
    [discordId]
  );
  return rows[0] ?? null;
}

export async function getRegistrationByPlayerId(playerId) {
  const [rows] = await pool.execute(
    'SELECT * FROM player_registrations WHERE player_id = ?',
    [playerId]
  );
  return rows[0] ?? null;
}

export async function upsertRegistration(discordId, playerId) {
  await pool.execute(
    `INSERT INTO player_registrations (discord_id, player_id, registered_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE player_id = VALUES(player_id), registered_at = VALUES(registered_at)`,
    [discordId, playerId, Date.now()]
  );
}

export async function getAllRegistrations() {
  const [rows] = await pool.execute('SELECT * FROM player_registrations');
  return rows;
}

export async function getPlayerIdToDiscordIdMap() {
  const [rows] = await pool.execute('SELECT player_id, discord_id FROM player_registrations');
  return new Map(rows.map((r) => [r.player_id, r.discord_id]));
}

// --- Role Sync ---

export async function getRecentMonths(window = 3) {
  const [rows] = await pool.execute(
    `SELECT DISTINCT DATE_FORMAT(date, '%Y-%m') AS month
     FROM tournaments
     ORDER BY month DESC
     LIMIT ?`,
    [window]
  );
  return rows.map((r) => r.month);
}

export async function getRecentAttendanceCounts(window = 3) {
  const months = await getRecentMonths(window);
  if (months.length === 0) return new Map();

  const placeholders = months.map(() => '?').join(',');
  const [rows] = await pool.execute(
    `SELECT
      pr.discord_id,
      COUNT(DISTINCT DATE_FORMAT(t.date, '%Y-%m')) AS recent_count
    FROM player_registrations pr
    LEFT JOIN attendances a ON pr.player_id = a.player_id
    LEFT JOIN tournaments t
      ON a.tournament_id = t.id
      AND DATE_FORMAT(t.date, '%Y-%m') IN (${placeholders})
    GROUP BY pr.discord_id`,
    months
  );

  return new Map(rows.map((r) => [r.discord_id, r.recent_count]));
}

// --- Attendance history for /attendance command ---

export async function getPlayerAttendanceHistory(playerId, limit = 10) {
  const [rows] = await pool.execute(
    `SELECT t.name, t.date, t.id
     FROM attendances a
     JOIN tournaments t ON a.tournament_id = t.id
     WHERE a.player_id = ?
     ORDER BY t.uploaded_at DESC
     LIMIT ?`,
    [playerId, limit]
  );
  return rows;
}

// --- Events ---

export async function upsertEvent(event) {
  await pool.execute(
    `INSERT INTO events (guid, type, title, date, time, store, location, link, posted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       type = VALUES(type),
       title = VALUES(title),
       date = VALUES(date),
       time = VALUES(time),
       store = VALUES(store),
       location = VALUES(location),
       link = VALUES(link)`,
    [event.guid, event.type, event.title, event.date, event.time, event.store, event.location, event.link]
  );
}

export async function getUnpostedEvents() {
  const [rows] = await pool.execute('SELECT * FROM events WHERE posted = 0 ORDER BY date ASC, time ASC');
  return rows;
}

export async function markEventPosted(guid, discordEventId = null) {
  await pool.execute(
    'UPDATE events SET posted = 1, discord_event_id = ? WHERE guid = ?',
    [discordEventId, guid]
  );
}

export async function getEventsWithDiscordEvent() {
  const [rows] = await pool.execute(
    'SELECT guid, discord_event_id FROM events WHERE discord_event_id IS NOT NULL'
  );
  return rows;
}

export async function getUpcomingEvents() {
  const today = new Date().toISOString().split('T')[0];
  const [rows] = await pool.execute(
    'SELECT * FROM events WHERE date >= ? ORDER BY date ASC, time ASC',
    [today]
  );
  return rows;
}

export async function cleanPastEvents() {
  const today = new Date().toISOString().split('T')[0];
  await pool.execute('DELETE FROM events WHERE date < ?', [today]);
}

export async function clearAllEvents() {
  const [result] = await pool.execute('DELETE FROM events');
  return result.affectedRows;
}
