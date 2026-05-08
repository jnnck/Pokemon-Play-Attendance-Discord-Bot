# Event subscription via Discord — design

**Status:** approved
**Date:** 2026-05-08

## Goal

When an event in the external `stacks_event_manager` database is opened for registration, the bot posts a subscribe message to a configured Discord channel. Users click a button to reserve a spot. Registered players get a one-click confirm; new players fill in a modal that creates their `players` row in the external database. All successful subscriptions create a `reservations` row with status `confirmed` (or `waitlist` if the event is full).

## Context

The Laravel app at `/Users/jnnck/Sites/inschrijvings-app` owns three tables in `stacks_event_manager`:

- **`events`** — `name`, `slug`, `date_time`, `registrations_open` (bool), `posted_to_discord` (bool), `pokemon_event_id`, `price`, `max_spots`, `deleted_at`
- **`players`** — `first_name`, `last_name` (nullable), `player_id` (nullable, unique), `email`, `phone`, `discord_username`, `discord_id` (nullable, unique), `deleted_at`
- **`reservations`** — `event_id`, `player_id`, `status` (`unconfirmed`/`confirmed`/`waitlist`/`cancelled`), `paid`, `confirmation_token`, `token_expires_at`. A virtual unique column `active_event_player` prevents two non-cancelled reservations for the same `(event_id, player_id)` pair.

Both databases live on the same MariaDB instance, so the bot can reuse the existing `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` credentials and just connect to a different database name.

The bot already has a working pattern for periodic polling and posting (see `src/tasks/eventFetcher.js`), which the new feature mirrors.

## High-level flow

1. Every 60 seconds, the new poller queries the external DB for events with `registrations_open=1 AND posted_to_discord=0 AND deleted_at IS NULL`.
2. For each such event, the bot posts an embed plus a "Subscribe" button to the subscribe channel, then sets `posted_to_discord = 1` on that row.
3. When a user clicks the button:
   - If a `players` row exists for their `discord_id`: show an ephemeral "Reserve a spot for {event}? [Confirm] [Cancel]" message.
   - If no `players` row exists: show a Discord modal asking for first name, last name, and player ID. On submit, create the `players` row.
4. On final confirmation, count active reservations for the event.
   - If `active_count < max_spots`: insert reservation with `status = 'confirmed'`.
   - Else: insert with `status = 'waitlist'` and tell the user.

## Architecture

### Modules (new)

- **`src/stacksDb.js`** — second `mysql2` connection pool to `stacks_event_manager`, plus query functions for events, players, and reservations. Keeps the cross-database boundary explicit. The bot's own `database.js` is not modified.
- **`src/tasks/stacksEventPoller.js`** — exports `pollStacksEvents(client)`. Fetches unposted open-registration events, posts the embed + button to the subscribe channel, marks them posted. Mirrors the structure of `src/tasks/eventFetcher.js`.
- **`src/handlers/stacksSubscribe.js`** — exports three handler functions:
  - `handleSubscribeButton(interaction)` — initial button click; routes to confirmation message or modal
  - `handleSubscribeModal(interaction)` — modal submit for new players; creates `players` row, then creates reservation directly (no second confirmation step needed since they just typed their details)
  - `handleSubscribeConfirm(interaction)` — confirm button click for existing players; creates reservation

### Modules (modified)

- **`src/index.js`** —
  - Start `pollStacksEvents(client)` on `ClientReady` if `STACKS_SUBSCRIBE_CHANNEL_ID` is set, alongside existing pollers, on the same 60s cadence.
  - Extend the `InteractionCreate` handler: in addition to `isChatInputCommand()`, check `isButton()` and `isModalSubmit()` and dispatch by `customId` prefix.
- **`src/embeds.js`** — add `buildSubscribeEmbed(event)` helper.

### Custom IDs (interaction routing)

- `stacks-sub:<event_id>` — initial Subscribe button on the public post
- `stacks-sub-modal:<event_id>` — modal submission (first-time players)
- `stacks-sub-confirm:<event_id>` — Confirm button on the ephemeral confirmation message
- `stacks-sub-cancel` — Cancel button on the ephemeral confirmation message (no event_id needed; just dismisses)

The `InteractionCreate` dispatcher in `index.js` matches the `customId` prefix and forwards to the right handler.

### Environment variables (new)

- `STACKS_DB_NAME` — name of the external database (e.g. `stacks_event_manager`)
- `STACKS_SUBSCRIBE_CHANNEL_ID` — Discord channel ID for posts (default value during initial deployment: `1502361028229464337`)

If `STACKS_SUBSCRIBE_CHANNEL_ID` is not set, the poller is not started — same defensive pattern as the existing `EVENTS_CHANNEL_ID`.

Reuse `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`. Update `.env.example` accordingly.

## Data interactions with stacks_event_manager

The bot is a *consumer* of the Laravel-owned schema. It does not run migrations and does not create tables. Read/write boundaries:

- **Read** `events` — filter `registrations_open=1 AND posted_to_discord=0 AND deleted_at IS NULL`, order by `date_time`
- **Write** `events.posted_to_discord = 1` after posting (no other columns touched)
- **Read** `players` — lookup by `discord_id`, filter `deleted_at IS NULL`
- **Read** `players` — lookup by `player_id` (for uniqueness check during first-time modal)
- **Write** `players` insert — `first_name`, `last_name`, `player_id`, `discord_id`, `discord_username`, plus Laravel's `created_at`/`updated_at`
- **Read** `reservations` — count active for event (`status IN ('unconfirmed','confirmed')`), check whether this player already has an active reservation for this event
- **Write** `reservations` insert — `event_id`, `player_id`, `status`, `created_at`, `updated_at`

The bot writes Laravel-style timestamps (`created_at`, `updated_at`) so Eloquent reads stay consistent.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| "Confirmation modal" for known users | Ephemeral message with Confirm/Cancel buttons | Discord modals require text inputs; the user described a confirmation dialog |
| Event at capacity | Auto-waitlist using existing `waitlist` status | Laravel app already supports it; no UI changes needed |
| Already-reserved (active reservation exists) | Ephemeral "you're already signed up" | No double-booking; no cancellation flow yet |
| Cancellation flow | Out of scope for v1 | Can add a Cancel button on the embed in v2 |
| Live spot counts on embed | Static (no live updates) | Ship simpler; can be added with `editMessage` later |
| `/register` ↔ `players` sync | Independent for v1 | The bot's `player_registrations` (TDF flow) and Laravel's `players` table stay separate; users registered via `/register` will still hit the first-time modal |
| `player_id` conflict during modal | Reject with error message | `players.player_id` is unique; let user retry |
| Soft-deleted events/players | Excluded (`deleted_at IS NULL`) | Match Laravel semantics |
| Capacity race (event fills between confirm-click and insert) | Wrap count + insert in a transaction with `SELECT ... FOR UPDATE` on the event row | Prevents over-capacity when two users confirm simultaneously |
| Duplicate-reservation race (user double-clicks Confirm) | Catch unique constraint violation on `uniq_active_event_player`, reply "already signed up" | The Laravel app's virtual unique column handles it at the DB level |

## Error handling

- DB errors during polling: log via `log.error`, swallow, retry next tick (same as `eventFetcher.js`).
- DB errors during interactions: log, reply ephemerally with "Something went wrong. Please try again." (same pattern as the existing top-level handler).
- Posting failures: do **not** mark `posted_to_discord = 1` if the channel send threw — leave it for retry next tick.
- Player-ID-already-used: respond ephemerally "Player ID X is registered to another Discord account. Contact an admin if this is a mistake."

## What's not in scope (YAGNI)

- Editing the public post when spots fill up
- Cancelling reservations from Discord
- Payment / `paid` status flow
- Listing current subscribers in the embed
- Syncing `/register` with the Laravel `players` table
- Migrating, mutating, or owning any schema in `stacks_event_manager`

## Testing

The repo has no test framework. Manual checklist (the implementation plan will expand this):

- Insert an event in `stacks_event_manager.events` with `registrations_open=1`, `posted_to_discord=0`. Verify the embed appears in the channel within 60s and the row's `posted_to_discord` flips to 1.
- Click Subscribe as a user with no `players` row. Confirm modal appears, on submit a `players` row is created with the right fields, and a `reservations` row exists with `status='confirmed'`.
- Click Subscribe as a user with an existing `players` row. Confirm the Confirm/Cancel ephemeral appears, and on Confirm a reservation is created.
- Click Subscribe again with an active reservation. Confirm the "already signed up" reply.
- Fill the event to `max_spots`. Next subscriber should land on `waitlist` with the appropriate message.
- Submit the modal with a `player_id` that's already in use by a different `discord_id`. Confirm the rejection message.
- Click Cancel on the confirmation ephemeral. Confirm no reservation is created and the message is dismissed.
