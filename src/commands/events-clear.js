import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { clearAllEvents } from '../database.js';
import { M } from '../messages.js';

export const data = new SlashCommandBuilder()
  .setName('events-clear')
  .setDescription(M.commands.eventsClear.description)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const count = await clearAllEvents();
  await interaction.reply({ content: M.commands.eventsClear.cleared(count) });
}
