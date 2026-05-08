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
