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
} from '../stacksDb.js';
import { log } from '../logger.js';

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
    await showSignupModal(interaction, eventId);
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
      content: 'Your player profile is missing. Click Subscribe again to register.',
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
