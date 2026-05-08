import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  getPlayerByDiscordId,
  getPlayerByPlayerId,
  createPlayer,
  getEventById,
  createReservationForPlayer,
  getActiveReservation,
  cancelActiveReservation,
} from '../stacksDb.js';
import { log } from '../logger.js';
import { M } from '../messages.js';

/**
 * Handle the initial "Subscribe" button click on a public event post.
 * customId is `stacks-sub:<eventId>`.
 *
 * Existing player → ephemeral Confirm/Cancel.
 * New player → opens first-time signup modal.
 */
export async function handleSubscribeButton(interaction) {
  const eventId = Number(interaction.customId.split(':')[1]);
  const discordId = interaction.user.id;

  const event = await getEventById(eventId);
  if (!event) {
    await interaction.reply({ content: M.subscribe.eventUnavailable, ephemeral: true });
    return;
  }

  const player = await getPlayerByDiscordId(discordId);
  if (!player) {
    await showSignupModal(interaction, eventId);
    return;
  }

  const existing = await getActiveReservation(eventId, player.id);
  if (existing) {
    const phrasing = existing.status === 'waitlist'
      ? M.subscribe.alreadyOnWaitlist(event.name)
      : M.subscribe.alreadyRegistered(event.name);
    await interaction.reply({
      content: M.subscribe.unregisterPrompt(phrasing),
      ephemeral: true,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`stacks-sub-unregister:${eventId}`)
            .setLabel(M.buttons.unregister)
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId('stacks-sub-cancel')
            .setLabel(M.buttons.close)
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return;
  }

  await interaction.reply({
    content: M.subscribe.confirmPrompt(event.name),
    ephemeral: true,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`stacks-sub-confirm:${eventId}`)
          .setLabel(M.buttons.confirm)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('stacks-sub-cancel')
          .setLabel(M.buttons.cancel)
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
      content: M.subscribe.profileMissingFull,
      components: [],
    });
    return;
  }

  const event = await getEventById(eventId);
  if (!event) {
    await interaction.update({ content: M.subscribe.eventUnavailable, components: [] });
    return;
  }

  const result = await createReservationForPlayer(eventId, player.id);
  await interaction.update({
    content: replyForResult(result, event.name),
    components: hasActiveAfter(result) ? [buildUnregisterRow(eventId)] : [],
  });
  log.info(`[stacksSubscribe] Reservation ${result.status} for event ${eventId}, player ${player.id}`);
}

/**
 * Handle the "Cancel" click in the ephemeral.
 */
export async function handleSubscribeCancel(interaction) {
  await interaction.update({ content: M.subscribe.noChanges, components: [] });
}

/**
 * Handle the "Unregister" click in the already-registered ephemeral.
 * customId is `stacks-sub-unregister:<eventId>`.
 */
export async function handleSubscribeUnregister(interaction) {
  const eventId = Number(interaction.customId.split(':')[1]);
  const discordId = interaction.user.id;

  const player = await getPlayerByDiscordId(discordId);
  if (!player) {
    await interaction.update({
      content: M.subscribe.profileMissingShort,
      components: [],
    });
    return;
  }

  const event = await getEventById(eventId);
  if (!event) {
    await interaction.update({ content: M.subscribe.eventUnavailable, components: [] });
    return;
  }

  const cancelled = await cancelActiveReservation(eventId, player.id);
  await interaction.update({
    content: cancelled
      ? M.subscribe.cancelled(event.name)
      : M.subscribe.noActiveReservation(event.name),
    components: [],
  });
  log.info(`[stacksSubscribe] Unregister for event ${eventId}, player ${player.id} (cancelled=${cancelled})`);
}

function hasActiveAfter(result) {
  return result.status === 'confirmed' || result.status === 'waitlist' || result.status === 'duplicate';
}

function buildUnregisterRow(eventId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`stacks-sub-unregister:${eventId}`)
      .setLabel(M.buttons.unregister)
      .setStyle(ButtonStyle.Danger),
  );
}

function replyForResult(result, eventName) {
  switch (result.status) {
    case 'confirmed':
      return M.subscribe.confirmed(eventName);
    case 'waitlist':
      return M.subscribe.waitlist(eventName);
    case 'duplicate':
      return M.subscribe.duplicate(eventName);
    default:
      return M.subscribe.statusFallback(result.status);
  }
}

async function showSignupModal(interaction, eventId) {
  const modal = new ModalBuilder()
    .setCustomId(`stacks-sub-modal:${eventId}`)
    .setTitle(M.modal.title);

  const firstName = new TextInputBuilder()
    .setCustomId('first_name')
    .setLabel(M.modal.firstName)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const lastName = new TextInputBuilder()
    .setCustomId('last_name')
    .setLabel(M.modal.lastName)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(100);

  const playerId = new TextInputBuilder()
    .setCustomId('player_id')
    .setLabel(M.modal.playerId)
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
    await interaction.reply({ content: M.subscribe.eventUnavailable, ephemeral: true });
    return;
  }

  // Reject if this player_id is already linked to a different Discord account.
  const existingByPlayerId = await getPlayerByPlayerId(playerId);
  if (existingByPlayerId && existingByPlayerId.discord_id !== discordId) {
    await interaction.reply({
      content: M.subscribe.playerIdTakenByOther(playerId),
      ephemeral: true,
    });
    return;
  }

  // Reject if this Discord ID somehow already has a player row (race or stale modal).
  const existingByDiscord = await getPlayerByDiscordId(discordId);
  if (existingByDiscord) {
    await interaction.reply({
      content: M.subscribe.accountAlreadyLinked,
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
    components: hasActiveAfter(result) ? [buildUnregisterRow(eventId)] : [],
  });
  log.info(`[stacksSubscribe] First-time signup: created player ${newPlayerId}, reservation ${result.status}`);
}
