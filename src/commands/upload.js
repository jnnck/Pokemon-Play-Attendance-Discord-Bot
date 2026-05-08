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
import { buildLeaderboardEmbed, buildStandingsEmbeds } from '../embeds.js';
import { log } from '../logger.js';
import { M } from '../messages.js';

export const data = new SlashCommandBuilder()
  .setName('upload')
  .setDescription(M.commands.upload.description)
  .addAttachmentOption((opt) =>
    opt.setName('file').setDescription(M.commands.upload.fileOptionDescription).setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  await interaction.deferReply();

  const attachment = interaction.options.getAttachment('file');

  if (!attachment.name.toLowerCase().endsWith('.tdf')) {
    return interaction.editReply({ content: M.commands.upload.wrongFileType, ephemeral: true });
  }

  let buffer;
  try {
    const response = await fetch(attachment.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    return interaction.editReply({ content: M.commands.upload.downloadFailed(err.message) });
  }

  let parsed;
  try {
    parsed = parseTDF(buffer);
  } catch (err) {
    return interaction.editReply({ content: M.commands.upload.parseFailed(err.message) });
  }

  const tournamentId = await insertTournament({
    name: parsed.name,
    date: parsed.date,
    uploadedBy: interaction.user.id,
  });

  await insertAttendances(tournamentId, parsed.players);
  const playerCount = await getAttendanceCountForTournament(tournamentId);

  const syncResult = await syncAttendanceRoles(interaction.guild);

  const confirmEmbed = new EmbedBuilder()
    .setTitle(M.commands.upload.embedTitle)
    .setColor(0x3498db)
    .addFields(
      { name: M.commands.upload.fieldTournament, value: parsed.name, inline: true },
      { name: M.commands.upload.fieldDate, value: parsed.date, inline: true },
      { name: M.commands.upload.fieldPlayersRecorded, value: String(playerCount), inline: true },
    );

  if (syncResult.added.length > 0) {
    confirmEmbed.addFields({
      name: M.commands.upload.fieldRoleGranted(syncResult.added.length),
      value: syncResult.added.map((id) => `<@${id}>`).join('\n'),
    });
  }
  if (syncResult.removed.length > 0) {
    confirmEmbed.addFields({
      name: M.commands.upload.fieldRoleRemoved(syncResult.removed.length),
      value: syncResult.removed.map((id) => `<@${id}>`).join('\n'),
    });
  }

  await interaction.editReply({ embeds: [confirmEmbed] });

  const resultsChannelId = process.env.RESULTS_CHANNEL_ID;
  if (resultsChannelId && parsed.standings.length > 0) {
    const resultsChannel = interaction.guild.channels.cache.get(resultsChannelId);
    if (resultsChannel?.isTextBased()) {
      const discordMap = await getPlayerIdToDiscordIdMap();
      const standingsEmbeds = buildStandingsEmbeds(parsed.name, parsed.date, parsed.standings, discordMap);
      await resultsChannel.send({ embeds: standingsEmbeds });
      await resultsChannel.send({ embeds: [buildLeaderboardEmbed(await getTopPlayers(10))] });
    } else {
      log.warn(`[upload] RESULTS_CHANNEL_ID ${resultsChannelId} not found or not a text channel.`);
    }
  }
}
