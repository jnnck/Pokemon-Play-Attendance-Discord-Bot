import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { parseTDF } from '../tdfParser.js';
import {
  insertTournament,
  insertAttendances,
  getAttendanceCountForTournament,
  getTopPlayers,
  getPlayerIdToDiscordIdMap,
} from '../database.js';
import { syncAttendanceRoles } from '../tasks/roleSync.js';

export const data = new SlashCommandBuilder()
  .setName('upload')
  .setDescription('Upload a TDF file to record tournament results')
  .addAttachmentOption((opt) =>
    opt.setName('file').setDescription('The .tdf file exported from Tournament Manager').setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  await interaction.deferReply();

  const attachment = interaction.options.getAttachment('file');

  if (!attachment.name.toLowerCase().endsWith('.tdf')) {
    return interaction.editReply({ content: 'Please upload a `.tdf` file.', ephemeral: true });
  }

  let buffer;
  try {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    return interaction.editReply(`Failed to download the file: ${err.message}`);
  }

  let parsed;
  try {
    parsed = parseTDF(buffer);
  } catch (err) {
    return interaction.editReply(`Could not parse TDF file: ${err.message}`);
  }

  const tournamentId = insertTournament({
    name: parsed.name,
    date: parsed.date,
    uploadedBy: interaction.user.id,
  });

  insertAttendances(tournamentId, parsed.players);
  const playerCount = getAttendanceCountForTournament(tournamentId);

  const syncResult = await syncAttendanceRoles(interaction.guild);

  const top10 = getTopPlayers(10);

  const confirmEmbed = new EmbedBuilder()
    .setTitle('Tournament Uploaded')
    .setColor(0x3498db)
    .addFields(
      { name: 'Tournament', value: parsed.name, inline: true },
      { name: 'Date', value: parsed.date, inline: true },
      { name: 'Players recorded', value: String(playerCount), inline: true },
    );

  if (syncResult) {
    if (syncResult.added.length > 0) {
      confirmEmbed.addFields({
        name: `Role granted (${syncResult.added.length})`,
        value: syncResult.added.map((id) => `<@${id}>`).join('\n'),
      });
    }
    if (syncResult.removed.length > 0) {
      confirmEmbed.addFields({
        name: `Role removed (${syncResult.removed.length})`,
        value: syncResult.removed.map((id) => `<@${id}>`).join('\n'),
      });
    }
  }

  await interaction.editReply({ embeds: [confirmEmbed] });

  // Post standings to the results channel if configured
  const resultsChannelId = process.env.RESULTS_CHANNEL_ID;
  if (resultsChannelId && parsed.standings.length > 0) {
    const resultsChannel = interaction.guild.channels.cache.get(resultsChannelId);
    if (resultsChannel?.isTextBased()) {
      const discordMap = getPlayerIdToDiscordIdMap();
      const embeds = buildStandingsEmbeds(parsed.name, parsed.date, parsed.standings, discordMap);
      await resultsChannel.send({ embeds });
      await resultsChannel.send({ embeds: [buildLeaderboardEmbed(top10)] });
    } else {
      console.warn(`[upload] RESULTS_CHANNEL_ID ${resultsChannelId} not found or not a text channel.`);
    }
  }
}

function buildLeaderboardEmbed(players) {
  const medals = ['🥇', '🥈', '🥉'];

  const lines = players.map((p, i) => {
    const prefix = medals[i] ?? `**${i + 1}.**`;
    const name = p.discord_id ? `<@${p.discord_id}>` : p.player_name;
    return `${prefix} ${name} — ${p.events_attended} event${p.events_attended !== 1 ? 's' : ''}`;
  });

  return new EmbedBuilder()
    .setTitle('All-Time Top 10 Most Active Players')
    .setColor(0xf1c40f)
    .setDescription(lines.length > 0 ? lines.join('\n') : 'No data yet.')
    .setTimestamp();
}

const CATEGORY_COLORS = { '2': 0xe74c3c, '1': 0x3498db, '0': 0x2ecc71 };
const PLACE_MEDALS = ['🥇', '🥈', '🥉'];

function buildStandingsEmbeds(tournamentName, date, standings, discordMap = new Map()) {
  // First embed: header
  const header = new EmbedBuilder()
    .setTitle(`Results — ${tournamentName}`)
    .setDescription(date)
    .setColor(0x9b59b6)
    .setTimestamp();

  // One embed per category
  const categoryEmbeds = standings.map((pod) => {
    const formatName = (p) => {
      const discordId = discordMap.get(p.player_id);
      return discordId ? `${p.player_name} (<@${discordId}>)` : p.player_name;
    };

    const lines = pod.finished.map((p) => {
      const prefix = PLACE_MEDALS[p.place - 1] ?? `**${p.place}.**`;
      return `${prefix} ${formatName(p)}`;
    });

    if (pod.dnf.length > 0) {
      lines.push('', '*Did not finish:*');
      for (const p of pod.dnf) lines.push(`• ${formatName(p)}`);
    }

    return new EmbedBuilder()
      .setTitle(pod.label)
      .setColor(CATEGORY_COLORS[pod.category] ?? 0x95a5a6)
      .setDescription(lines.join('\n') || '*No results*');
  });

  return [header, ...categoryEmbeds];
}
