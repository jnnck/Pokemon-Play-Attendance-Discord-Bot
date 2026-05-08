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
