import { getReservationsForUpcomingEvents, isStacksEnabled } from '../stacksDb.js';
import {
  getReservationNotificationsMap,
  upsertReservationNotification,
  getReservationNotificationCount,
} from '../database.js';
import { buildNewReservationEmbed, buildStatusChangeEmbed } from '../embeds.js';
import { log } from '../logger.js';

/**
 * Poll reservations and notify the configured channel about:
 *   - new reservations (any source: web form, manual, discord)
 *   - status changes on previously-seen reservations
 *
 * On first run (notifications table empty), snapshot current state silently
 * so we only notify on transitions from this point forward.
 */
export async function pollReservationNotifications(client) {
  if (!isStacksEnabled()) return;

  const channelId = process.env.STACKS_RESERVATIONS_CHANNEL_ID;
  if (!channelId) return;

  const channel = client.channels.cache.get(channelId);
  if (!channel?.isTextBased()) {
    log.warn(`[reservationNotifier] STACKS_RESERVATIONS_CHANNEL_ID ${channelId} not found or not a text channel.`);
    return;
  }

  let reservations;
  try {
    reservations = await getReservationsForUpcomingEvents();
  } catch (err) {
    log.error('[reservationNotifier] Failed to fetch reservations:', err);
    return;
  }

  let knownCount;
  try {
    knownCount = await getReservationNotificationCount();
  } catch (err) {
    log.error('[reservationNotifier] Failed to read notification count:', err);
    return;
  }

  if (knownCount === 0) {
    // First run: snapshot without notifying.
    for (const r of reservations) {
      try {
        await upsertReservationNotification(r.id, r.status);
      } catch (err) {
        log.error(`[reservationNotifier] Failed to bootstrap reservation ${r.id}:`, err);
      }
    }
    log.info(`[reservationNotifier] First-run bootstrap: ${reservations.length} reservation(s) snapshotted, no messages sent.`);
    return;
  }

  let known;
  try {
    known = await getReservationNotificationsMap();
  } catch (err) {
    log.error('[reservationNotifier] Failed to load notifications map:', err);
    return;
  }

  for (const r of reservations) {
    const lastStatus = known.get(r.id);
    if (lastStatus === undefined) {
      try {
        await channel.send({ embeds: [buildNewReservationEmbed(r)] });
        await upsertReservationNotification(r.id, r.status);
        log.info(`[reservationNotifier] Notified NEW reservation ${r.id} (${r.status}) for event ${r.event_id}.`);
      } catch (err) {
        log.error(`[reservationNotifier] Failed to notify new reservation ${r.id}:`, err);
      }
    } else if (lastStatus !== r.status) {
      try {
        await channel.send({ embeds: [buildStatusChangeEmbed(r, lastStatus)] });
        await upsertReservationNotification(r.id, r.status);
        log.info(`[reservationNotifier] Notified STATUS CHANGE ${r.id}: ${lastStatus} → ${r.status}.`);
      } catch (err) {
        log.error(`[reservationNotifier] Failed to notify status change for ${r.id}:`, err);
      }
    }
  }
}
