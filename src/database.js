import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';

mkdirSync('./data', { recursive: true });

const db = new Database('./data/tournament.db');

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    date        TEXT NOT NULL,
    uploaded_at INTEGER NOT NULL,
    uploaded_by TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendances (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id INTEGER NOT NULL,
    player_id     TEXT NOT NULL,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_attendances_player_id     ON attendances(player_id);
  CREATE INDEX IF NOT EXISTS idx_attendances_tournament_id ON attendances(tournament_id);

  CREATE TABLE IF NOT EXISTS player_registrations (
    discord_id    TEXT PRIMARY KEY,
    player_id     TEXT NOT NULL UNIQUE,
    registered_at INTEGER NOT NULL
  );
`);

// --- Tournaments ---

export function insertTournament({ name, date, uploadedBy }) {
  const stmt = db.prepare(
    'INSERT INTO tournaments (name, date, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(name, date, Date.now(), uploadedBy);
  return result.lastInsertRowid;
}

export function getRecentTournamentIds(limit = 3) {
  return db
    .prepare('SELECT id FROM tournaments ORDER BY uploaded_at DESC LIMIT ?')
    .all(limit)
    .map((r) => r.id);
}

export function getTournamentCount() {
  return db.prepare('SELECT COUNT(*) as count FROM tournaments').get().count;
}

export function getAllTournaments() {
  return db
    .prepare('SELECT * FROM tournaments ORDER BY uploaded_at DESC')
    .all();
}

export function getTournamentById(id) {
  return db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id);
}

export function deleteTournament(id) {
  db.transaction(() => {
    db.prepare('DELETE FROM attendances WHERE tournament_id = ?').run(id);
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(id);
  })();
}

// --- Attendances ---

export function insertAttendances(tournamentId, players) {
  const stmt = db.prepare(
    'INSERT INTO attendances (tournament_id, player_id, first_name, last_name) VALUES (?, ?, ?, ?)'
  );
  const insertMany = db.transaction((rows) => {
    for (const { player_id, first_name, last_name } of rows) {
      stmt.run(tournamentId, player_id, first_name, last_name ?? '');
    }
  });
  insertMany(players);
}

export function getAttendanceCountForTournament(tournamentId) {
  return db
    .prepare('SELECT COUNT(*) as count FROM attendances WHERE tournament_id = ?')
    .get(tournamentId).count;
}

// --- Leaderboard ---

export function getTopPlayers(limit = 10) {
  return db
    .prepare(
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
      LIMIT ?`
    )
    .all(limit);
}

// --- Player Registrations ---

export function getRegistrationByDiscordId(discordId) {
  return db
    .prepare('SELECT * FROM player_registrations WHERE discord_id = ?')
    .get(discordId);
}

export function getRegistrationByPlayerId(playerId) {
  return db
    .prepare('SELECT * FROM player_registrations WHERE player_id = ?')
    .get(playerId);
}

export function upsertRegistration(discordId, playerId) {
  db.prepare(
    `INSERT INTO player_registrations (discord_id, player_id, registered_at)
     VALUES (?, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET player_id = excluded.player_id, registered_at = excluded.registered_at`
  ).run(discordId, playerId, Date.now());
}

export function getAllRegistrations() {
  return db.prepare('SELECT * FROM player_registrations').all();
}

export function getPlayerIdToDiscordIdMap() {
  const rows = db.prepare('SELECT player_id, discord_id FROM player_registrations').all();
  return new Map(rows.map((r) => [r.player_id, r.discord_id]));
}

// --- Role Sync ---

/**
 * Returns the last `window` distinct calendar months (YYYY-MM) that had tournaments,
 * ordered most recent first.
 */
export function getRecentMonths(window = 3) {
  return db
    .prepare(
      `SELECT DISTINCT strftime('%Y-%m', date) AS month
       FROM tournaments
       ORDER BY month DESC
       LIMIT ?`
    )
    .all(window)
    .map((r) => r.month);
}

/**
 * Returns a map of discordId -> number of recent months attended for all registered players.
 * A month counts if the player attended at least one tournament in it.
 */
export function getRecentAttendanceCounts(window = 3) {
  const months = getRecentMonths(window);
  if (months.length === 0) return new Map();

  const placeholders = months.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT
        pr.discord_id,
        COUNT(DISTINCT strftime('%Y-%m', t.date)) AS recent_count
      FROM player_registrations pr
      LEFT JOIN attendances a ON pr.player_id = a.player_id
      LEFT JOIN tournaments t
        ON a.tournament_id = t.id
        AND strftime('%Y-%m', t.date) IN (${placeholders})
      GROUP BY pr.discord_id`
    )
    .all(...months);

  return new Map(rows.map((r) => [r.discord_id, r.recent_count]));
}

// --- Attendance history for /attendance command ---

export function getPlayerAttendanceHistory(playerId, limit = 10) {
  return db
    .prepare(
      `SELECT t.name, t.date, t.id
       FROM attendances a
       JOIN tournaments t ON a.tournament_id = t.id
       WHERE a.player_id = ?
       ORDER BY t.uploaded_at DESC
       LIMIT ?`
    )
    .all(playerId, limit);
}
