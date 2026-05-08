# Event Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Discord users subscribe to events stored in `stacks_event_manager` via a button posted in a channel, with a one-click confirm for known players and a modal for first-time signups.

**Architecture:** A second `mysql2` pool connects to `stacks_event_manager` on the same host. A new poller scans every 60s for events with `registrations_open=1 AND posted_to_discord=0`, posts an embed with a Subscribe button, and marks them posted. Button clicks fan out to either a Confirm/Cancel ephemeral (existing player) or a modal (new player); both paths converge on a capacity-aware reservation insert that auto-falls-back to `waitlist` when full.

**Tech Stack:** Node.js 24 ESM, discord.js v14, mysql2/promise, MariaDB.

**Spec:** [`docs/superpowers/specs/2026-05-08-event-subscription-design.md`](../specs/2026-05-08-event-subscription-design.md)

**Testing note:** This repo has no test framework or linter (per CLAUDE.md). Verification is manual at each task — do not skip the verification steps; they are the equivalent of test runs.

**Pre-req for verification:** A locally accessible `stacks_event_manager` database (the Laravel app at `/Users/jnnck/Sites/inschrijvings-app` can create it via `php artisan migrate`). The DB user in `.env` must have read/write access to both `tcgbot` and `stacks_event_manager`.

---

## File Structure

**New files:**
- `src/stacksDb.js` — second mysql2 pool + all read/write functions for the external DB
- `src/handlers/stacksSubscribe.js` — button, modal, and confirm interaction handlers
- `src/tasks/stacksEventPoller.js` — 60s poller that posts new open-registration events

**Modified files:**
- `.env.example` — add `STACKS_DB_NAME` and `STACKS_SUBSCRIBE_CHANNEL_ID`
- `src/embeds.js` — add `buildSubscribeEmbed`
- `src/index.js` — init stacks pool, start stacks poller, dispatch button/modal interactions

---

## Task 1: Add stacks DB module with all query functions

**Files:**
- Create: `src/stacksDb.js`
- Modify: `.env.example`
- Modify: `src/index.js` (call `initStacksDb()` after `initDatabase()`)

- [ ] **Step 1: Add env vars to `.env.example`**

Append to [.env.example](../../../.env.example):

```
# External "stacks_event_manager" database (same MariaDB server as DB_*)
# Leave STACKS_DB_NAME empty to disable the event subscription feature.
STACKS_DB_NAME=stacks_event_manager

# Channel where event subscribe posts are published
STACKS_SUBSCRIBE_CHANNEL_ID=
```

- [ ] **Step 2: Create `src/stacksDb.js` with the pool and all query functions**

Write this complete file:

```javascript
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
```

- [ ] **Step 3: Wire `initStacksDb` into `src/index.js`**

In [src/index.js](../../../src/index.js), update the bottom of the file. Replace:

```javascript
await initDatabase();
client.login(token);
```

With:

```javascript
await initDatabase();
await initStacksDb();
client.login(token);
```

And add the import near the other database import at the top:

```javascript
import { initDatabase } from './database.js';
import { initStacksDb } from './stacksDb.js';
```

- [ ] **Step 4: Syntax-check both files**

Run:
```bash
node --check src/stacksDb.js
node --check src/index.js
```
Expected: both exit silently with code 0.

- [ ] **Step 5: Manual verification — bot boots and connects**

In `.env`, set `STACKS_DB_NAME=stacks_event_manager` (assuming the Laravel app's DB exists locally). Then:

```bash
npm start
```

Expected log line: `[stacksDb] Connected to stacks_event_manager.`

If `STACKS_DB_NAME` is left empty, expected: `[stacksDb] STACKS_DB_NAME not set; subscription feature disabled.` and the bot still starts normally.

Stop the bot (Ctrl-C).

- [ ] **Step 6: Commit**

```bash
git add .env.example src/stacksDb.js src/index.js
git commit -m "Add stacks_event_manager DB connection layer"
```

---

## Task 2: Add subscribe embed and event poller

**Files:**
- Modify: `src/embeds.js` (add `buildSubscribeEmbed` and `buildSubscribeRow`)
- Create: `src/tasks/stacksEventPoller.js`
- Modify: `src/index.js` (start the poller alongside the existing one)

- [ ] **Step 1: Add embed + button row helpers in `src/embeds.js`**

Append to [src/embeds.js](../../../src/embeds.js):

```javascript
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * Format a date_time string from MariaDB (e.g. "2026-05-15 19:00:00")
 * as a Discord timestamp using the long-date-with-time style.
 */
function formatEventDateTime(dateTimeStr) {
  const ts = Math.floor(new Date(dateTimeStr.replace(' ', 'T')).getTime() / 1000);
  return `<t:${ts}:F>`;
}

export function buildSubscribeEmbed(event) {
  const embed = new EmbedBuilder()
    .setTitle(event.name)
    .setColor(0x5865f2)
    .addFields({ name: 'When', value: formatEventDateTime(event.date_time), inline: false });

  const price = Number(event.price);
  if (price > 0) {
    embed.addFields({ name: 'Price', value: `€${price.toFixed(2)}`, inline: true });
  }
  embed.addFields({ name: 'Spots', value: String(event.max_spots), inline: true });
  embed.setFooter({ text: 'Click below to reserve your spot.' });

  return embed;
}

export function buildSubscribeRow(eventId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stacks-sub:${eventId}`)
      .setLabel('Subscribe')
      .setStyle(ButtonStyle.Primary)
  );
}
```

- [ ] **Step 2: Create `src/tasks/stacksEventPoller.js`**

Write this complete file:

```javascript
import { getOpenUnpostedEvents, markEventPostedToDiscord, isStacksEnabled } from '../stacksDb.js';
import { buildSubscribeEmbed, buildSubscribeRow } from '../embeds.js';
import { log } from '../logger.js';

/**
 * Poll the stacks_event_manager DB for events with registrations open
 * and post a subscribe message for each. Marks each event posted only
 * after a successful send.
 */
export async function pollStacksEvents(client) {
  if (!isStacksEnabled()) return;

  const channelId = process.env.STACKS_SUBSCRIBE_CHANNEL_ID;
  if (!channelId) return;

  try {
    const events = await getOpenUnpostedEvents();
    if (events.length === 0) return;

    const channel = client.channels.cache.get(channelId);
    if (!channel?.isTextBased()) {
      log.warn(`[stacksEventPoller] STACKS_SUBSCRIBE_CHANNEL_ID ${channelId} not found or not a text channel.`);
      return;
    }

    for (const event of events) {
      try {
        await channel.send({
          embeds: [buildSubscribeEmbed(event)],
          components: [buildSubscribeRow(event.id)],
        });
        await markEventPostedToDiscord(event.id);
        log.info(`[stacksEventPoller] Posted subscribe message for event ${event.id}: ${event.name}`);
      } catch (err) {
        log.error(`[stacksEventPoller] Failed to post event ${event.id}:`, err);
        // Do not mark posted on failure; will retry next tick.
      }
    }
  } catch (err) {
    log.error('[stacksEventPoller] Poll failed:', err);
  }
}
```

- [ ] **Step 3: Start the poller in `src/index.js`**

In [src/index.js](../../../src/index.js), add the import:

```javascript
import { pollStacksEvents } from './tasks/stacksEventPoller.js';
```

Then update the `ClientReady` handler to start the new poller. Replace:

```javascript
client.once(Events.ClientReady, (c) => {
  log.info(`Logged in as ${c.user.tag}`);
  log.info(`Serving ${c.guilds.cache.size} guild(s)`);

  // Start event polling
  if (process.env.EVENTS_CHANNEL_ID && process.env.POKEMON_EVENT_LAT) {
    pollEvents(client);
    setInterval(() => pollEvents(client), EVENT_POLL_INTERVAL);
    log.info('Event polling started (every 60s)');
  }
});
```

With:

```javascript
client.once(Events.ClientReady, (c) => {
  log.info(`Logged in as ${c.user.tag}`);
  log.info(`Serving ${c.guilds.cache.size} guild(s)`);

  // Start event polling
  if (process.env.EVENTS_CHANNEL_ID && process.env.POKEMON_EVENT_LAT) {
    pollEvents(client);
    setInterval(() => pollEvents(client), EVENT_POLL_INTERVAL);
    log.info('Event polling started (every 60s)');
  }

  if (process.env.STACKS_SUBSCRIBE_CHANNEL_ID) {
    pollStacksEvents(client);
    setInterval(() => pollStacksEvents(client), EVENT_POLL_INTERVAL);
    log.info('Stacks event subscription polling started (every 60s)');
  }
});
```

- [ ] **Step 4: Syntax-check**

Run:
```bash
node --check src/embeds.js
node --check src/tasks/stacksEventPoller.js
node --check src/index.js
```
Expected: all silent, exit 0.

- [ ] **Step 5: Manual verification — public post appears**

Set `STACKS_SUBSCRIBE_CHANNEL_ID` in `.env` to channel `1502361028229464337` (or a private test channel of your choice).

In a MySQL client, insert a test event in `stacks_event_manager`:

```sql
INSERT INTO events (name, slug, date_time, registrations_open, posted_to_discord, price, max_spots, created_at, updated_at)
VALUES ('Test League Cup', 'test-league-cup', '2026-06-01 14:00:00', 1, 0, 5.00, 16, NOW(), NOW());
```

Start the bot:
```bash
npm start
```

Expected within 60s:
- An embed appears in the configured channel titled "Test League Cup" with When/Price/Spots fields and a blue **Subscribe** button below it.
- Log: `[stacksEventPoller] Posted subscribe message for event N: Test League Cup`
- The DB row's `posted_to_discord` is now `1`.

Verify in MySQL:
```sql
SELECT id, name, posted_to_discord FROM events WHERE slug = 'test-league-cup';
```

Clicking the button at this stage produces a "This interaction failed" error in Discord — that's expected; the handler is added in the next task.

Stop the bot.

- [ ] **Step 6: Commit**

```bash
git add src/embeds.js src/tasks/stacksEventPoller.js src/index.js
git commit -m "Post subscribe embed for events opened for registration"
```

---

## Task 3: Add interaction dispatcher and handler skeleton

**Files:**
- Create: `src/handlers/stacksSubscribe.js` (skeleton with one stub function)
- Modify: `src/index.js` (route buttons + modals to handlers)

This task wires the plumbing for routing component/modal interactions. The actual subscribe logic is added in Tasks 4 and 5.

- [ ] **Step 1: Create `src/handlers/stacksSubscribe.js` with a stub button handler**

Write this complete file:

```javascript
import { log } from '../logger.js';

/**
 * Handle the initial "Subscribe" button click on a public event post.
 * The customId is `stacks-sub:<eventId>`.
 */
export async function handleSubscribeButton(interaction) {
  const eventId = Number(interaction.customId.split(':')[1]);
  log.info(`[stacksSubscribe] Subscribe clicked for event ${eventId} by ${interaction.user.tag}`);

  await interaction.reply({
    content: 'Subscription flow not implemented yet.',
    ephemeral: true,
  });
}
```

- [ ] **Step 2: Wire button dispatching into `src/index.js`**

In [src/index.js](../../../src/index.js), add the import:

```javascript
import { handleSubscribeButton } from './handlers/stacksSubscribe.js';
```

Replace the existing `InteractionCreate` handler:

```javascript
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  const context = `/${interaction.commandName} — ${interaction.user.tag} (${interaction.user.id}) in #${interaction.channel?.name ?? 'unknown'}`;

  log.info(`Command: ${context}`);

  try {
    await command.execute(interaction);
    log.info(`Done:    ${context}`);
  } catch (err) {
    log.error(`Failed:  ${context}`, err);

    const payload = { content: 'Something went wrong. Please try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch((e) => log.error('Failed to send error reply:', e));
    } else {
      await interaction.reply(payload).catch((e) => log.error('Failed to send error reply:', e));
    }
  }
});
```

With:

```javascript
async function replyWithError(interaction, err, context) {
  log.error(`Failed:  ${context}`, err);
  const payload = { content: 'Something went wrong. Please try again.', ephemeral: true };
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload).catch((e) => log.error('Failed to send error reply:', e));
  } else {
    await interaction.reply(payload).catch((e) => log.error('Failed to send error reply:', e));
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    const context = `/${interaction.commandName} — ${interaction.user.tag} (${interaction.user.id}) in #${interaction.channel?.name ?? 'unknown'}`;
    log.info(`Command: ${context}`);

    try {
      await command.execute(interaction);
      log.info(`Done:    ${context}`);
    } catch (err) {
      await replyWithError(interaction, err, context);
    }
    return;
  }

  if (interaction.isButton()) {
    const context = `button:${interaction.customId} — ${interaction.user.tag}`;
    try {
      if (interaction.customId.startsWith('stacks-sub:')
        || interaction.customId.startsWith('stacks-sub-confirm:')
        || interaction.customId === 'stacks-sub-cancel') {
        await handleSubscribeButton(interaction);
      }
    } catch (err) {
      await replyWithError(interaction, err, context);
    }
    return;
  }

  if (interaction.isModalSubmit()) {
    const context = `modal:${interaction.customId} — ${interaction.user.tag}`;
    try {
      if (interaction.customId.startsWith('stacks-sub-modal:')) {
        await handleSubscribeButton(interaction);
      }
    } catch (err) {
      await replyWithError(interaction, err, context);
    }
    return;
  }
});
```

Note: all three button custom IDs and the modal submit currently funnel into `handleSubscribeButton`, which is a placeholder. Tasks 4 and 5 split this into the real handlers.

- [ ] **Step 3: Syntax-check**

```bash
node --check src/handlers/stacksSubscribe.js
node --check src/index.js
```
Expected: silent, exit 0.

- [ ] **Step 4: Manual verification — button click responds**

Start the bot and click the **Subscribe** button on the event post from Task 2 (still present in your test channel).

Expected:
- Ephemeral reply: "Subscription flow not implemented yet."
- Log line: `[stacksSubscribe] Subscribe clicked for event N by <your tag>`

Stop the bot.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/stacksSubscribe.js src/index.js
git commit -m "Route Discord button and modal interactions to handlers"
```

---

## Task 4: Implement existing-player Confirm/Cancel flow

**Files:**
- Modify: `src/handlers/stacksSubscribe.js` (real button + confirm + cancel logic for known players)
- Modify: `src/index.js` (split dispatch by customId)

- [ ] **Step 1: Replace `src/handlers/stacksSubscribe.js` with the existing-player flow**

Replace the entire file with:

```javascript
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  getPlayerByDiscordId,
  getEventById,
  createReservationForPlayer,
} from '../stacksDb.js';
import { log } from '../logger.js';

const FIRST_TIME_NOTICE = 'First-time signup is not available yet — please ask an admin.';

/**
 * Handle the initial "Subscribe" button click on a public event post.
 * customId is `stacks-sub:<eventId>`.
 *
 * Existing player → ephemeral Confirm/Cancel.
 * New player → placeholder message (modal flow added in Task 5).
 */
export async function handleSubscribeButton(interaction) {
  const eventId = Number(interaction.customId.split(':')[1]);
  const discordId = interaction.user.id;

  const event = await getEventById(eventId);
  if (!event) {
    await interaction.reply({ content: 'This event is no longer available.', ephemeral: true });
    return;
  }

  const player = await getPlayerByDiscordId(discordId);
  if (!player) {
    await interaction.reply({ content: FIRST_TIME_NOTICE, ephemeral: true });
    return;
  }

  await interaction.reply({
    content: `Reserve a spot for **${event.name}**?`,
    ephemeral: true,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`stacks-sub-confirm:${eventId}`)
          .setLabel('Confirm')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('stacks-sub-cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}

/**
 * Handle the "Confirm" click in the ephemeral.
 * customId is `stacks-sub-confirm:<eventId>`.
 */
export async function handleSubscribeConfirm(interaction) {
  const eventId = Number(interaction.customId.split(':')[1]);
  const discordId = interaction.user.id;

  const player = await getPlayerByDiscordId(discordId);
  if (!player) {
    await interaction.update({
      content: FIRST_TIME_NOTICE,
      components: [],
    });
    return;
  }

  const event = await getEventById(eventId);
  if (!event) {
    await interaction.update({ content: 'This event is no longer available.', components: [] });
    return;
  }

  const result = await createReservationForPlayer(eventId, player.id);
  await interaction.update({
    content: replyForResult(result, event.name),
    components: [],
  });
  log.info(`[stacksSubscribe] Reservation ${result.status} for event ${eventId}, player ${player.id}`);
}

/**
 * Handle the "Cancel" click in the ephemeral.
 */
export async function handleSubscribeCancel(interaction) {
  await interaction.update({ content: 'Cancelled — no reservation made.', components: [] });
}

function replyForResult(result, eventName) {
  switch (result.status) {
    case 'confirmed':
      return `You're confirmed for **${eventName}**. See you there!`;
    case 'waitlist':
      return `**${eventName}** is currently full — you've been added to the waitlist. We'll be in touch if a spot opens up.`;
    case 'duplicate':
      return `You already have an active reservation for **${eventName}**.`;
    default:
      return `Reservation status: ${result.status}.`;
  }
}
```

- [ ] **Step 2: Update `src/index.js` to dispatch each customId to its handler**

In [src/index.js](../../../src/index.js), update the import:

```javascript
import { handleSubscribeButton, handleSubscribeConfirm, handleSubscribeCancel } from './handlers/stacksSubscribe.js';
```

Replace the button branch of the InteractionCreate handler:

```javascript
  if (interaction.isButton()) {
    const context = `button:${interaction.customId} — ${interaction.user.tag}`;
    try {
      if (interaction.customId.startsWith('stacks-sub:')
        || interaction.customId.startsWith('stacks-sub-confirm:')
        || interaction.customId === 'stacks-sub-cancel') {
        await handleSubscribeButton(interaction);
      }
    } catch (err) {
      await replyWithError(interaction, err, context);
    }
    return;
  }
```

With:

```javascript
  if (interaction.isButton()) {
    const context = `button:${interaction.customId} — ${interaction.user.tag}`;
    try {
      if (interaction.customId.startsWith('stacks-sub-confirm:')) {
        await handleSubscribeConfirm(interaction);
      } else if (interaction.customId === 'stacks-sub-cancel') {
        await handleSubscribeCancel(interaction);
      } else if (interaction.customId.startsWith('stacks-sub:')) {
        await handleSubscribeButton(interaction);
      }
    } catch (err) {
      await replyWithError(interaction, err, context);
    }
    return;
  }
```

(The modal branch stays as it was in Task 3 — replaced in Task 5.)

- [ ] **Step 3: Syntax-check**

```bash
node --check src/handlers/stacksSubscribe.js
node --check src/index.js
```
Expected: silent, exit 0.

- [ ] **Step 4: Manual verification — existing player happy path**

Pre-seed an existing player row mapped to your Discord account. Substitute your real Discord ID:

```sql
INSERT INTO players (first_name, last_name, player_id, discord_id, discord_username, created_at, updated_at)
VALUES ('Test', 'Player', '1234567', 'YOUR_DISCORD_ID', 'YOUR_USERNAME', NOW(), NOW());
```

Make sure there's still a posted, registrations_open event in the channel. (If you marked it posted in Task 2 and want a new post, set `posted_to_discord = 0` and wait 60s.)

Start the bot and click **Subscribe**.

Expected:
- Ephemeral message: "Reserve a spot for **Test League Cup**?" with **Confirm** and **Cancel** buttons.

Click **Confirm**. Expected:
- The ephemeral updates to: "You're confirmed for **Test League Cup**. See you there!"
- A row in `reservations` exists with `status='confirmed'`, your `player_id`, and the event's `event_id`. Verify:
  ```sql
  SELECT * FROM reservations WHERE event_id = (SELECT id FROM events WHERE slug='test-league-cup');
  ```

Click **Subscribe** again. Click **Confirm**. Expected:
- Ephemeral updates to: "You already have an active reservation for **Test League Cup**." (`duplicate` branch).

Click **Subscribe** again. Click **Cancel**. Expected:
- Ephemeral updates to: "Cancelled — no reservation made."
- No new reservation row.

- [ ] **Step 5: Manual verification — capacity / waitlist**

Set the event's max_spots to a small number and fill it up:

```sql
UPDATE events SET max_spots = 1 WHERE slug = 'test-league-cup';
-- The reservation from Step 4 already occupies the only spot.
```

Insert another player with a different `discord_id` (or unlink yours and use a different Discord account):

```sql
INSERT INTO players (first_name, last_name, player_id, discord_id, discord_username, created_at, updated_at)
VALUES ('Other', 'Player', '7654321', 'SECOND_DISCORD_ID', 'second_user', NOW(), NOW());
```

Have that user click **Subscribe** → **Confirm**.

Expected:
- Ephemeral: "**Test League Cup** is currently full — you've been added to the waitlist. We'll be in touch if a spot opens up."
- A new reservations row with `status='waitlist'`.

- [ ] **Step 6: Manual verification — first-time placeholder**

With a Discord account that has no `players` row, click **Subscribe**.

Expected:
- Ephemeral: "First-time signup is not available yet — please ask an admin."

Stop the bot.

- [ ] **Step 7: Commit**

```bash
git add src/handlers/stacksSubscribe.js src/index.js
git commit -m "Add Confirm/Cancel reservation flow for existing players"
```

---

## Task 5: Implement first-time-player modal flow

**Files:**
- Modify: `src/handlers/stacksSubscribe.js` (replace `FIRST_TIME_NOTICE` placeholder with modal)
- Modify: `src/index.js` (dispatch modal submits)

- [ ] **Step 1: Add modal show + submit handlers in `src/handlers/stacksSubscribe.js`**

Edit `src/handlers/stacksSubscribe.js`. Replace this entire import line:

```javascript
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
```

With:

```javascript
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
```

Add this import to the existing stacksDb import:

```javascript
import {
  getPlayerByDiscordId,
  getPlayerByPlayerId,
  createPlayer,
  getEventById,
  createReservationForPlayer,
} from '../stacksDb.js';
```

Remove the line:

```javascript
const FIRST_TIME_NOTICE = 'First-time signup is not available yet — please ask an admin.';
```

In `handleSubscribeButton`, replace this block:

```javascript
  const player = await getPlayerByDiscordId(discordId);
  if (!player) {
    await interaction.reply({ content: FIRST_TIME_NOTICE, ephemeral: true });
    return;
  }
```

With:

```javascript
  const player = await getPlayerByDiscordId(discordId);
  if (!player) {
    await showSignupModal(interaction, eventId);
    return;
  }
```

In `handleSubscribeConfirm`, replace this block:

```javascript
  const player = await getPlayerByDiscordId(discordId);
  if (!player) {
    await interaction.update({
      content: FIRST_TIME_NOTICE,
      components: [],
    });
    return;
  }
```

With:

```javascript
  const player = await getPlayerByDiscordId(discordId);
  if (!player) {
    await interaction.update({
      content: 'Your player profile is missing. Click Subscribe again to register.',
      components: [],
    });
    return;
  }
```

Append these new functions to the end of the file:

```javascript
async function showSignupModal(interaction, eventId) {
  const modal = new ModalBuilder()
    .setCustomId(`stacks-sub-modal:${eventId}`)
    .setTitle('First-time signup');

  const firstName = new TextInputBuilder()
    .setCustomId('first_name')
    .setLabel('First name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const lastName = new TextInputBuilder()
    .setCustomId('last_name')
    .setLabel('Last name')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const playerId = new TextInputBuilder()
    .setCustomId('player_id')
    .setLabel('Pokemon player ID')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(64);

  modal.addComponents(
    new ActionRowBuilder().addComponents(firstName),
    new ActionRowBuilder().addComponents(lastName),
    new ActionRowBuilder().addComponents(playerId),
  );

  await interaction.showModal(modal);
}

/**
 * Handle the modal submission for a first-time signup.
 * customId is `stacks-sub-modal:<eventId>`.
 */
export async function handleSubscribeModal(interaction) {
  const eventId = Number(interaction.customId.split(':')[1]);
  const discordId = interaction.user.id;
  const firstName = interaction.fields.getTextInputValue('first_name').trim();
  const lastName = interaction.fields.getTextInputValue('last_name').trim();
  const playerId = interaction.fields.getTextInputValue('player_id').trim();

  const event = await getEventById(eventId);
  if (!event) {
    await interaction.reply({ content: 'This event is no longer available.', ephemeral: true });
    return;
  }

  // Reject if this player_id is already linked to a different Discord account.
  const existingByPlayerId = await getPlayerByPlayerId(playerId);
  if (existingByPlayerId && existingByPlayerId.discord_id !== discordId) {
    await interaction.reply({
      content: `Player ID **${playerId}** is registered to another Discord account. Contact an admin if this is a mistake.`,
      ephemeral: true,
    });
    return;
  }

  // Reject if this Discord ID somehow already has a player row (race or stale modal).
  const existingByDiscord = await getPlayerByDiscordId(discordId);
  if (existingByDiscord) {
    await interaction.reply({
      content: 'Your account is already linked. Click Subscribe again.',
      ephemeral: true,
    });
    return;
  }

  const newPlayerId = await createPlayer({
    firstName,
    lastName,
    playerId,
    discordId,
    discordUsername: interaction.user.username,
  });

  const result = await createReservationForPlayer(eventId, newPlayerId);
  await interaction.reply({
    content: replyForResult(result, event.name),
    ephemeral: true,
  });
  log.info(`[stacksSubscribe] First-time signup: created player ${newPlayerId}, reservation ${result.status}`);
}
```

- [ ] **Step 2: Wire the modal dispatcher in `src/index.js`**

Update the import:

```javascript
import {
  handleSubscribeButton,
  handleSubscribeConfirm,
  handleSubscribeCancel,
  handleSubscribeModal,
} from './handlers/stacksSubscribe.js';
```

Replace the modal branch:

```javascript
  if (interaction.isModalSubmit()) {
    const context = `modal:${interaction.customId} — ${interaction.user.tag}`;
    try {
      if (interaction.customId.startsWith('stacks-sub-modal:')) {
        await handleSubscribeButton(interaction);
      }
    } catch (err) {
      await replyWithError(interaction, err, context);
    }
    return;
  }
```

With:

```javascript
  if (interaction.isModalSubmit()) {
    const context = `modal:${interaction.customId} — ${interaction.user.tag}`;
    try {
      if (interaction.customId.startsWith('stacks-sub-modal:')) {
        await handleSubscribeModal(interaction);
      }
    } catch (err) {
      await replyWithError(interaction, err, context);
    }
    return;
  }
```

- [ ] **Step 3: Syntax-check**

```bash
node --check src/handlers/stacksSubscribe.js
node --check src/index.js
```
Expected: silent, exit 0.

- [ ] **Step 4: Manual verification — first-time signup happy path**

Clean up so your test Discord account has no `players` row:

```sql
DELETE FROM reservations WHERE player_id IN (SELECT id FROM players WHERE discord_id = 'YOUR_DISCORD_ID');
DELETE FROM players WHERE discord_id = 'YOUR_DISCORD_ID';
UPDATE events SET max_spots = 16, posted_to_discord = 0 WHERE slug = 'test-league-cup';
```

Wait 60s for the new post (or restart the bot). Click **Subscribe**.

Expected:
- A modal opens with "First-time signup" titled at top, three fields (First name, Last name, Pokemon player ID).

Fill in: First="Alice", Last="Smith", Player ID="9999999". Submit.

Expected:
- Ephemeral reply: "You're confirmed for **Test League Cup**. See you there!"
- A new `players` row with first_name='Alice', last_name='Smith', player_id='9999999', discord_id=YOUR_DISCORD_ID, discord_username matches your Discord username.
- A new `reservations` row with status='confirmed'.

```sql
SELECT * FROM players WHERE discord_id = 'YOUR_DISCORD_ID';
SELECT * FROM reservations WHERE player_id = (SELECT id FROM players WHERE discord_id = 'YOUR_DISCORD_ID');
```

- [ ] **Step 5: Manual verification — duplicate player_id rejection**

Click **Subscribe** as a different Discord account that has no `players` row. Open the modal, enter player_id="9999999" (same as Alice's). Submit.

Expected:
- Ephemeral reply: "Player ID **9999999** is registered to another Discord account. Contact an admin if this is a mistake."
- No new `players` row.

- [ ] **Step 6: Manual verification — second click after registration**

As Alice again, click **Subscribe**. (She's now in `players`, not first-time.)

Expected:
- Ephemeral with Confirm/Cancel ("Reserve a spot for **Test League Cup**?")
- Click Confirm → "You already have an active reservation for **Test League Cup**." (because she already reserved during Step 4).

Stop the bot.

- [ ] **Step 7: Commit**

```bash
git add src/handlers/stacksSubscribe.js src/index.js
git commit -m "Add first-time signup modal flow for new players"
```

---

## Task 6: Final end-to-end verification

**Files:** none modified.

This task is a single pass through the spec's testing checklist on a clean slate to confirm nothing regressed across tasks.

- [ ] **Step 1: Reset test state**

```sql
DELETE FROM reservations;
DELETE FROM players WHERE discord_id IN ('YOUR_DISCORD_ID', 'SECOND_DISCORD_ID');
DELETE FROM events WHERE slug = 'test-league-cup';
```

- [ ] **Step 2: Run through the spec's testing checklist**

From [the spec](../specs/2026-05-08-event-subscription-design.md) (Testing section), in order:

1. Insert an event with `registrations_open=1, posted_to_discord=0`. Within 60s the embed appears in the channel; `posted_to_discord` flips to 1.
2. Click Subscribe as a user with no `players` row. Modal opens. Submit → `players` row created, `reservations` row with `status='confirmed'`.
3. Click Subscribe as the now-existing player. Confirm/Cancel ephemeral appears. Confirm → "already signed up" (duplicate, since they just reserved).
4. Click Subscribe as a fresh user, set event to `max_spots=1`, fill the slot, then have a third user click Subscribe → completes signup → lands on `waitlist`.
5. Submit modal with a `player_id` already used by a different `discord_id` → rejection message.
6. Click Subscribe → click Cancel → no reservation, ephemeral confirms cancellation.

- [ ] **Step 3: Sanity-check the disabled mode**

Comment out `STACKS_DB_NAME` in `.env`, restart the bot.

Expected:
- Log: `[stacksDb] STACKS_DB_NAME not set; subscription feature disabled.`
- No "Stacks event subscription polling started" line.
- The bot still starts and other commands (`/leaderboard`, `/upload`, etc.) work.

Re-enable `STACKS_DB_NAME` and restart.

- [ ] **Step 4: Final review**

Skim the diff: `git log --oneline main..HEAD` and `git diff main..HEAD --stat`. Confirm:
- 5 task commits (Tasks 1–5)
- No accidental changes outside the expected files
- `.env.example` documents both new vars
