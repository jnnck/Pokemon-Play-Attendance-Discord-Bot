import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUpcomingEvents } from '../database.js';
import { M } from '../messages.js';

const EVENT_COLORS = {
  'League Challenge': 0xe67e22,
  'League Cup': 0x9b59b6,
  'nonpremier TCG': 0x3498db,
  'Prerelease': 0x2ecc71,
};

export const data = new SlashCommandBuilder()
  .setName('events')
  .setDescription(M.commands.events.description);

export async function execute(interaction) {
  const events = await getUpcomingEvents();

  if (events.length === 0) {
    return interaction.reply({ content: M.commands.events.noUpcoming, ephemeral: true });
  }

  const lines = events.map((e) => {
    const time = e.time ? ` ${e.time}` : '';
    const link = e.link ? ` — [details](${e.link})` : '';
    return M.commands.events.line(e.date, time, e.title, e.store, link);
  });

  const embed = new EmbedBuilder()
    .setTitle(M.commands.events.embedTitle)
    .setColor(0x3498db)
    .setDescription(lines.join('\n'))
    .setFooter({ text: M.commands.events.footer(events.length) })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
