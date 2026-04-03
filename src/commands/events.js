import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getUpcomingEvents } from '../database.js';

const EVENT_COLORS = {
  'League Challenge': 0xe67e22,
  'League Cup': 0x9b59b6,
  'nonpremier TCG': 0x3498db,
  'Prerelease': 0x2ecc71,
};

export const data = new SlashCommandBuilder()
  .setName('events')
  .setDescription('Show upcoming Pokemon TCG events near us');

export async function execute(interaction) {
  const events = await getUpcomingEvents();

  if (events.length === 0) {
    return interaction.reply({ content: 'No upcoming events found.', ephemeral: true });
  }

  const lines = events.map((e) => {
    const time = e.time ? ` ${e.time}` : '';
    const link = e.link ? ` — [details](${e.link})` : '';
    return `**${e.date}${time}** — ${e.title}${e.store ? ` @ ${e.store}` : ''}${link}`;
  });

  const embed = new EmbedBuilder()
    .setTitle('Upcoming Events')
    .setColor(0x3498db)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${events.length} event${events.length !== 1 ? 's' : ''} found` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
