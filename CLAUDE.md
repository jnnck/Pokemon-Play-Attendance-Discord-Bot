# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies (requires Node 24 — run `nvm use` first)
npm install

# Register slash commands with Discord (run once, or after adding/changing commands)
npm run deploy

# Start the bot (requires a running MariaDB instance)
npm start
```

There are no tests or a linter configured.

## Architecture

This is a Node.js ESM (`"type": "module"`) Discord bot using discord.js v14 and MariaDB (via mysql2).

**Request flow:** `src/index.js` receives every slash command interaction and dispatches to the matching handler in `src/commands/`. Each handler is a module that exports `data` (a `SlashCommandBuilder`) and `execute(interaction)`.

**Adding a new command** requires three steps: create the file in `src/commands/`, import and register it in both `src/index.js` and `deploy-commands.js`, then run `npm run deploy`.

**Key modules:**
- `src/database.js` — MariaDB connection pool (async via mysql2/promise), all schema creation, and every query function. `initDatabase()` must be called (and awaited) before the bot starts. All database functions are async and must be awaited.
- `src/tdfParser.js` — parses TDF files (XML format from Pokemon Tournament Manager). Returns `{ name, date, players, standings }`. Players are stored with separate `first_name`/`last_name` fields.
- `src/embeds.js` — all Discord embed builders live here. `formatName(first, last)` applies the privacy shortening (`"Firstname L."`). All display of player names must go through this function.
- `src/tasks/roleSync.js` — exports `REQUIRED_MONTHS`, `WINDOW`, and `qualifiesForRole()`. These constants are the single source of truth for role eligibility logic and are imported by the commands that need to display eligibility status.
- `src/logger.js` — thin wrapper around `console.*` that adds ISO timestamps. Use `log.info/warn/error` everywhere instead of `console.*`.

**Role sync logic:** A player earns the attendance role if they attended at least one tournament in `REQUIRED_MONTHS` (2) of the last `WINDOW` (3) distinct calendar months that had any tournament. `syncAttendanceRoles(guild)` is called after every `/upload` and `/tournament-delete`.

**Player identity:** TDF files use a numeric `userid`. Players link their Discord account to this ID via `/register`. The join key between `attendances` and `player_registrations` is `player_id` (stored as VARCHAR).

**Privacy:** Full names are stored in the DB as `first_name` + `last_name`. Public display always uses `formatName()` from `src/embeds.js` which shortens to "Firstname L.".

## Event subscription / `stacks_event_manager` integration

The bot also integrates with a second MariaDB schema, `stacks_event_manager`, owned by a Laravel app at `/Users/jnnck/Sites/inschrijvings-app`. The bot is a **consumer**: it never runs migrations, never creates tables, never alters columns there. It reads from `events`/`players`/`reservations` and writes:
- `events.posted_to_discord = 1` (after a successful post)
- `players` inserts (first-time signups via Discord modal)
- `reservations` inserts/updates (via `createReservationForPlayer`, `cancelActiveReservation`)

**Modules:**
- `src/stacksDb.js` — second `mysql2` pool to `stacks_event_manager` (same host/port/user/password as the bot's own DB, different `database` name). All cross-DB queries live here. `initStacksDb()` no-ops cleanly if `STACKS_DB_NAME` is unset.
- `src/tasks/stacksEventPoller.js` — every 60s (same `EVENT_POLL_INTERVAL` as the pokedata poller): posts new open events to `STACKS_SUBSCRIBE_CHANNEL_ID` with a Register button, and refreshes the spot count on every previously-posted event still open and upcoming.
- `src/handlers/stacksSubscribe.js` — handles the four `stacks-sub*` button customIds (`stacks-sub:`, `stacks-sub-confirm:`, `stacks-sub-cancel`, `stacks-sub-unregister:`) and the `stacks-sub-modal:` modal submission. The dispatcher in `src/index.js` routes by customId prefix.
- Bot-local table `stacks_event_messages` (created in `src/database.js`) maps `event_id → channel_id, message_id` so the poller can edit posted embeds. Discord error 10008 (Unknown Message) drops the row so deleted posts stop being retried.

**Reservation semantics owned by the bot:**
- New rows are tagged `source = 'discord'` (the column also accepts `'form'`/`'manual'` from the Laravel app).
- Re-registering after Unregister **reuses** the cancelled row by flipping its status back to `confirmed`/`waitlist` rather than inserting a new row. The cancelled-row reuse + capacity check happen in a single `FOR UPDATE` transaction in `createReservationForPlayer`.
- Capacity-counting status values are `unconfirmed`/`confirmed`; `waitlist` does not count toward capacity. The Laravel app's `ReservationStatus::countsTowardCapacity()` is the canonical definition.
- The schema's virtual unique constraint `uniq_active_event_player` prevents two non-cancelled reservations per `(event_id, player_id)`. The bot catches `ER_DUP_ENTRY` and returns `{ status: 'duplicate' }`.

## Environment variables

See `.env.example`. `ATTENDANCE_ROLE_ID` and `RESULTS_CHANNEL_ID` are optional — the bot skips role sync or results posting if they are absent. The bot's Discord role must be ranked above the attendance role in the server hierarchy.

Database connection is configured via `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` (see `.env.example`).

`STACKS_DB_NAME` and `STACKS_SUBSCRIBE_CHANNEL_ID` enable the event subscription feature. Both are optional; with either unset the feature is disabled and the bot otherwise runs normally. The DB user must have read/write access to `stacks_event_manager` in addition to the bot's own DB.

## Docker

```bash
# Build and run
docker compose up -d --build

# Register slash commands inside the container
docker compose run --rm bot node deploy-commands.js
```

The bot connects to an external hosted MariaDB configured via the `DB_*` environment variables.
