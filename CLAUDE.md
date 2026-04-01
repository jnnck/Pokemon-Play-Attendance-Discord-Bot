# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies (requires Node 24 — run `nvm use` first)
npm install

# Register slash commands with Discord (run once, or after adding/changing commands)
npm run deploy

# Start the bot
npm start
```

There are no tests or a linter configured.

## Architecture

This is a Node.js ESM (`"type": "module"`) Discord bot using discord.js v14 and better-sqlite3.

**Request flow:** `src/index.js` receives every slash command interaction and dispatches to the matching handler in `src/commands/`. Each handler is a module that exports `data` (a `SlashCommandBuilder`) and `execute(interaction)`.

**Adding a new command** requires three steps: create the file in `src/commands/`, import and register it in both `src/index.js` and `deploy-commands.js`, then run `npm run deploy`.

**Key modules:**
- `src/database.js` — single SQLite connection (synchronous via better-sqlite3), all schema creation, and every query function. The DB file is created at `data/tournament.db` on first run.
- `src/tdfParser.js` — parses TDF files (XML format from Pokemon Tournament Manager). Returns `{ name, date, players, standings }`. Players are stored with separate `first_name`/`last_name` fields.
- `src/embeds.js` — all Discord embed builders live here. `formatName(first, last)` applies the privacy shortening (`"Firstname L."`). All display of player names must go through this function.
- `src/tasks/roleSync.js` — exports `REQUIRED_MONTHS`, `WINDOW`, and `qualifiesForRole()`. These constants are the single source of truth for role eligibility logic and are imported by the commands that need to display eligibility status.
- `src/logger.js` — thin wrapper around `console.*` that adds ISO timestamps. Use `log.info/warn/error` everywhere instead of `console.*`.

**Role sync logic:** A player earns the attendance role if they attended at least one tournament in `REQUIRED_MONTHS` (2) of the last `WINDOW` (3) distinct calendar months that had any tournament. `syncAttendanceRoles(guild)` is called after every `/upload` and `/tournament-delete`.

**Player identity:** TDF files use a numeric `userid`. Players link their Discord account to this ID via `/register`. The join key between `attendances` and `player_registrations` is `player_id` (stored as TEXT).

**Privacy:** Full names are stored in the DB as `first_name` + `last_name`. Public display always uses `formatName()` from `src/embeds.js` which shortens to "Firstname L.".

## Environment variables

See `.env.example`. `ATTENDANCE_ROLE_ID` and `RESULTS_CHANNEL_ID` are optional — the bot skips role sync or results posting if they are absent. The bot's Discord role must be ranked above the attendance role in the server hierarchy.

## Docker

```bash
# Build and run
docker compose up -d --build

# Register slash commands inside the container
docker compose run --rm bot node deploy-commands.js
```

The `data/` directory is mounted as a volume so the database persists across rebuilds. The image uses `node:24-alpine` with Python/make/g++ for compiling better-sqlite3's native bindings.
