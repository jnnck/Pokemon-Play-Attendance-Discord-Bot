import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { clearAllEvents } from '../database.js';

export const data = new SlashCommandBuilder()
  .setName('events-clear')
  .setDescription('Clear all stored events')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const count = await clearAllEvents();
  await interaction.reply({ content: `Cleared **${count}** event${count !== 1 ? 's' : ''}. New events will be fetched on the next poll.` });
}
