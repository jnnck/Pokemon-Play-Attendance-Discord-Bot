import {
  getOpenUnpostedEvents,
  markEventPostedToDiscord,
  isStacksEnabled,
  getActiveReservationCount,
  getOpenPostedUpcomingEvents,
} from '../stacksDb.js';
import {
  upsertStacksEventMessage,
  getStacksEventMessages,
  deleteStacksEventMessage,
} from '../database.js';
import { buildSubscribeEmbed, buildSubscribeRow } from '../embeds.js';
import { log } from '../logger.js';

/**
 * Poll the stacks_event_manager DB and:
 *   1. post a subscribe message for each newly-open event,
 *   2. refresh the spot count on every previously-posted event that is
 *      still open and in the future.
 */
export async function pollStacksEvents(client) {
  if (!isStacksEnabled()) return;

  const channelId = process.env.STACKS_SUBSCRIBE_CHANNEL_ID;
  if (!channelId) return;

  const channel = client.channels.cache.get(channelId);
  if (!channel?.isTextBased()) {
    log.warn(`[stacksEventPoller] STACKS_SUBSCRIBE_CHANNEL_ID ${channelId} not found or not a text channel.`);
    return;
  }

  await postNewEvents(channel);
  await refreshExistingMessages(client);
}

async function postNewEvents(channel) {
  try {
    const events = await getOpenUnpostedEvents();
    for (const event of events) {
      try {
        const available = Math.max(0, event.max_spots - (await getActiveReservationCount(event.id)));
        const message = await channel.send({
          embeds: [buildSubscribeEmbed(event, available)],
          components: [buildSubscribeRow(event.id)],
        });
        await markEventPostedToDiscord(event.id);
        await upsertStacksEventMessage(event.id, channel.id, message.id);
        log.info(`[stacksEventPoller] Posted subscribe message for event ${event.id}: ${event.name}`);
      } catch (err) {
        log.error(`[stacksEventPoller] Failed to post event ${event.id}:`, err);
        // Do not mark posted on failure; will retry next tick.
      }
    }
  } catch (err) {
    log.error('[stacksEventPoller] postNewEvents failed:', err);
  }
}

async function refreshExistingMessages(client) {
  let tracked;
  try {
    tracked = await getStacksEventMessages();
  } catch (err) {
    log.error('[stacksEventPoller] Failed to load tracked messages:', err);
    return;
  }
  if (tracked.length === 0) return;

  let openEvents;
  try {
    openEvents = await getOpenPostedUpcomingEvents();
  } catch (err) {
    log.error('[stacksEventPoller] Failed to load open events:', err);
    return;
  }
  const openById = new Map(openEvents.map((e) => [e.id, e]));

  for (const row of tracked) {
    const event = openById.get(row.event_id);
    if (!event) {
      // Event closed, deleted, or in the past. Stop tracking it.
      // (We leave the message untouched in Discord so history is preserved.)
      try {
        await deleteStacksEventMessage(row.event_id);
      } catch (err) {
        log.error(`[stacksEventPoller] Failed to drop tracking for event ${row.event_id}:`, err);
      }
      continue;
    }

    try {
      const available = Math.max(0, event.max_spots - (await getActiveReservationCount(event.id)));
      const channel = client.channels.cache.get(row.channel_id);
      if (!channel?.isTextBased()) {
        log.warn(`[stacksEventPoller] Channel ${row.channel_id} not found while refreshing event ${event.id}; skipping.`);
        continue;
      }
      await channel.messages.edit(row.message_id, {
        embeds: [buildSubscribeEmbed(event, available)],
        components: [buildSubscribeRow(event.id)],
      });
    } catch (err) {
      // Discord error code 10008: Unknown Message — message was deleted, drop tracking.
      if (err?.code === 10008) {
        log.info(`[stacksEventPoller] Message for event ${event.id} no longer exists; dropping tracking.`);
        try {
          await deleteStacksEventMessage(event.id);
        } catch (delErr) {
          log.error(`[stacksEventPoller] Failed to drop tracking for event ${event.id}:`, delErr);
        }
        continue;
      }
      log.error(`[stacksEventPoller] Failed to refresh event ${event.id}:`, err);
    }
  }
}
