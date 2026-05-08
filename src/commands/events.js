import { SlashCommandBuilder } from 'discord.js';
import { getUpcomingEvents } from '../database.js';
import { buildUpcomingEventsEmbed } from '../embeds.js';

export const data = new SlashCommandBuilder()
  .setName('events')
  .setDescription('Show upcoming Pokemon TCG events near us');

export async function execute(interaction) {
  const events = await getUpcomingEvents();

  if (events.length === 0) {
    return interaction.reply({ content: 'No upcoming events found.', ephemeral: true });
  }

  await interaction.reply({ embeds: [buildUpcomingEventsEmbed(events)] });
}
