# TCG Discord Bot

A Discord bot for tracking Pokemon TCG tournament attendance. Parses TDF files exported from Tournament Manager, maintains an attendance role for active players, and posts standings and leaderboards after each event.

## Features

- Upload `.tdf` files to record tournament results
- Automatically assign/remove an attendance role for players active in 2 of the last 3 months
- Post per-category standings (Juniors / Seniors / Masters) to a dedicated results channel
- All-time leaderboard posted after each upload
- Players can link their Discord account to their TDF player ID

## Requirements

- Node.js 18+
- A Discord bot application with the **Server Members Intent** enabled

## Setup

### 1. Create a Discord bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) and create a new application
2. Go to **Bot** → enable **Server Members Intent** under Privileged Gateway Intents
3. Copy the bot token

### 2. Invite the bot to your server

In **OAuth2 → URL Generator**, select scopes `bot` and `applications.commands`, and enable the **Manage Roles** permission. Open the generated URL to invite the bot.

> The bot's role must be ranked **above** the attendance role in your server's role list, otherwise it cannot assign or remove it.

### 3. Configure environment variables

```bash
cp .env.example .env
```

Fill in all values in `.env`:

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Your bot token |
| `CLIENT_ID` | Your application's ID (General Information → Application ID) |
| `GUILD_ID` | Your server's ID (right-click server → Copy Server ID) |
| `ATTENDANCE_ROLE_ID` | ID of the role to assign to active players — create this in Discord first |
| `RESULTS_CHANNEL_ID` | ID of the channel where standings and the leaderboard are posted after each upload |

### 4. Install dependencies

```bash
npm install
```

### 5. Register slash commands

```bash
npm run deploy
```

This only needs to be run once, or again whenever commands are added or changed.

### 6. Start the bot

```bash
npm start
```

## Commands

| Command | Access | Description |
|---|---|---|
| `/register player_id:` | Everyone | Link your Discord account to your TDF player ID |
| `/attendance [user]` | Everyone | View attendance history and role status for yourself or another player |
| `/leaderboard` | Everyone | Show the all-time top 10 most active players |
| `/tournaments` | Everyone | List all recorded tournaments with date and player count |
| `/upload file:` | Manage Guild | Upload a `.tdf` file to record a tournament |
| `/tournament-delete id:` | Manage Guild | Delete a tournament and its attendance data by ID |

## Attendance role logic

A player receives the attendance role if they attended at least one tournament in **2 of the last 3 calendar months** that had any tournament. The role is automatically removed if they no longer meet this threshold. Role sync runs after every `/upload` and `/tournament-delete`.

Players must register their player ID with `/register` before their attendance is tracked for role purposes. Their player ID can be found in the official tournament result exports.

## TDF files

TDF (Tournament Data File) is the format exported by the official Pokemon Tournament Manager software. After finishing a tournament, export the file and upload it with `/upload`. The bot reads the player list and standings from the file — no manual data entry needed.

## Project structure

```
src/
├── index.js              # Bot entry point
├── database.js           # SQLite schema and all queries
├── tdfParser.js          # TDF/XML file parser
├── commands/
│   ├── upload.js
│   ├── register.js
│   ├── leaderboard.js
│   ├── attendance.js
│   ├── tournaments.js
│   └── tournament-delete.js
└── tasks/
    └── roleSync.js       # Attendance role assignment logic
data/
└── tournament.db         # SQLite database (auto-created, gitignored)
```
