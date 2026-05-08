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
