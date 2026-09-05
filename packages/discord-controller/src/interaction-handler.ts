import {
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  GuildMember,
  Message,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { cinemeta, resolveMediaStreams, MediaItem, MediaStream } from '@discord-stremio/metadata';
import { queueManager } from '@discord-stremio/queue';
import { sessionStore } from '@discord-stremio/sessions';
import {
  createPlayerEmbed,
  createPlayerControlRows,
  createQualitySelectMenu,
  createSubtitleSelectMenu,
  createSubtitleControlRows,
  createAudioSelectMenu,
} from '@discord-stremio/diagnostics';
import { ipcClient } from './ipc-client.js';

// Cache active player messages per guild to keep embed updated
export const activePlayerMessages: Map<string, Message> = new Map();
const pendingSearches: Map<string, { mediaItems: MediaItem[]; initialQuality: string }> = new Map();

/**
 * Handle Slash Command Interactions
 */
export async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName, guildId } = interaction;
  if (!guildId) {
    await interaction.reply({ content: '❌ Commands can only be used in a server.', ephemeral: true });
    return;
  }

  switch (commandName) {
    case 'movie':
    case 'play':
    case 'stream': {
      await handleStreamCommand(interaction, 'movie');
      break;
    }
    case 'series': {
      await handleStreamCommand(interaction, 'series');
      break;
    }
    case 'pause': {
      await interaction.deferReply({ ephemeral: true });
      const res = await ipcClient.sendCommand(guildId, 'PAUSE');
      await interaction.editReply(res.success ? '⏸️ Playback paused.' : `❌ Failed: ${res.error}`);
      await refreshPlayerMessage(guildId);
      break;
    }
    case 'resume': {
      await interaction.deferReply({ ephemeral: true });
      const res = await ipcClient.sendCommand(guildId, 'RESUME');
      await interaction.editReply(res.success ? '▶️ Playback resumed.' : `❌ Failed: ${res.error}`);
      await refreshPlayerMessage(guildId);
      break;
    }
    case 'seek': {
      const timeStr = interaction.options.getString('time') || interaction.options.getString('position') || '0';
      const seconds = parseTimeToSeconds(timeStr);
      await interaction.deferReply({ ephemeral: true });
      const res = await ipcClient.sendCommand(guildId, 'SEEK', { seconds });
      await interaction.editReply(res.success ? `⏩ Seeked to ${timeStr}.` : `❌ Failed: ${res.error}`);
      await refreshPlayerMessage(guildId);
      break;
    }
    case 'forward': {
      const sec = interaction.options.getInteger('seconds') || 10;
      await interaction.deferReply({ ephemeral: true });
      const res = await ipcClient.sendCommand(guildId, 'FORWARD', { seconds: sec });
      await interaction.editReply(res.success ? `⏩ Forwarded ${sec}s.` : `❌ Failed: ${res.error}`);
      await refreshPlayerMessage(guildId);
      break;
    }
    case 'rewind': {
      const sec = interaction.options.getInteger('seconds') || 10;
      await interaction.deferReply({ ephemeral: true });
      const res = await ipcClient.sendCommand(guildId, 'REWIND', { seconds: sec });
      await interaction.editReply(res.success ? `⏪ Rewound ${sec}s.` : `❌ Failed: ${res.error}`);
      await refreshPlayerMessage(guildId);
      break;
    }
    case 'stop': {
      await interaction.deferReply({ ephemeral: true });
      await ipcClient.sendCommand(guildId, 'STOP');
      await sessionStore.deleteSession(guildId);
      activePlayerMessages.delete(guildId);
      await interaction.editReply('⏹️ Playback stopped and session terminated.');
      break;
    }
    case 'subtitles': {
      const language = interaction.options.getString('language') || 'English';
      await interaction.deferReply({ ephemeral: true });
      const res = await ipcClient.sendCommand(guildId, 'SET_SUBTITLE', { language });
      await interaction.editReply(res.success ? `💬 Subtitles set to: **${language}**` : `❌ Failed: ${res.error}`);
      await refreshPlayerMessage(guildId);
      break;
    }
    case 'subdelay': {
      const offset = interaction.options.getNumber('offset') || 0;
      await interaction.deferReply({ ephemeral: true });
      const res = await ipcClient.sendCommand(guildId, 'SET_SUBTITLE_DELAY', { delaySeconds: offset });
      await interaction.editReply(res.success ? `💬 Subtitle delay set to: **${offset > 0 ? `+${offset}` : offset}s**` : `❌ Failed: ${res.error}`);
      await refreshPlayerMessage(guildId);
      break;
    }
    case 'audio': {
      const track = interaction.options.getString('track') || '0';
      await interaction.deferReply({ ephemeral: true });
      const res = await ipcClient.sendCommand(guildId, 'SET_AUDIO', { trackId: track });
      await interaction.editReply(res.success ? `🔊 Audio set to: **${track}**` : `❌ Failed: ${res.error}`);
      await refreshPlayerMessage(guildId);
      break;
    }
    case 'quality': {
      const resolution = interaction.options.getString('resolution') || '1080p';
      await interaction.deferReply({ ephemeral: true });
      const res = await ipcClient.sendCommand(guildId, 'SET_QUALITY', { quality: resolution });
      await interaction.editReply(res.success ? `⚙️ Stream quality set to: **${resolution.toUpperCase()}**` : `❌ Failed: ${res.error}`);
      await refreshPlayerMessage(guildId);
      break;
    }
    case 'queue': {
      await interaction.deferReply({ ephemeral: true });
      const items = await queueManager.list(guildId);
      if (items.length === 0) {
        await interaction.editReply('📜 The playback queue is currently empty.');
        return;
      }
      const list = items
        .map((it, idx) => `**${idx + 1}.** ${it.media.name} (${it.stream?.quality || "auto"}) - Requested by <@${it.requestedBy}>`)
        .join('\n');
      await interaction.editReply(`📜 **Current Queue (${items.length} items):**\n\n${list}`);
      break;
    }
    case 'ping': {
      const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      await interaction.editReply(`🏓 Pong! Round-trip latency: \`${latency}ms\``);
      break;
    }
    case 'admin': {
      await interaction.deferReply({ ephemeral: true });
      const stateRes = await ipcClient.sendCommand(guildId, 'GET_STATE');
      await interaction.editReply(`🛠️ System Status: Stream Worker is online, state: \`${stateRes.state?.status || 'IDLE'}\``);
      break;
    }
    default:
      await interaction.reply({ content: '❓ Unknown command.', ephemeral: true });
  }
}

/**
 * Handle Stream / Movie / Series Request
 */
async function handleStreamCommand(
  interaction: ChatInputCommandInteraction,
  type: 'movie' | 'series'
): Promise<void> {
  const title = interaction.options.getString('title') || interaction.options.getString('query') || '';
  const initialQuality = interaction.options.getString('quality') || '720p';

  if (!title) {
    await interaction.reply({ content: '❌ Please provide a title to search.', ephemeral: true });
    return;
  }

  const voiceChannel = (interaction.member as GuildMember)?.voice?.channel;
  if (!voiceChannel) {
    await interaction.reply({
      content: '⚠️ You must be in a voice channel to start playback.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    console.log(`[Controller] Searching for "${title}" via Cinemeta (Quality: ${initialQuality})...`);
    const results = await cinemeta.searchMedia(title, type);

    if (results.length === 0) {
      await interaction.editReply(`❌ No results found for **"${title}"**.`);
      return;
    }

    if (results.length === 1) {
      await startMediaPlayback(interaction, results[0], voiceChannel.id, undefined, initialQuality);
      return;
    }

    const searchId = Math.random().toString(36).substring(2, 10);
    const mediaSlice = results.slice(0, 10);
    pendingSearches.set(searchId, { mediaItems: mediaSlice, initialQuality });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🔍 Search Results: "${title}"`)
      .setDescription(mediaSlice.map((it, idx) => `**${idx + 1}.** ${it.name} ${it.releaseInfo ? `(${it.releaseInfo})` : ''}`).join('\n'))
      .setFooter({ text: `Quality: ${initialQuality.toUpperCase()} • Select an option below to start playback` });

    const options = mediaSlice.map((it, idx) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${idx + 1}. ${it.name}`.substring(0, 100))
        .setValue(`item_${idx}`)
        .setDescription(it.releaseInfo ? `Year: ${it.releaseInfo}` : 'Select to play')
    );

    const selectMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`search_select:${searchId}`)
        .setPlaceholder(`Choose a title to stream in ${initialQuality.toUpperCase()}`)
        .addOptions(options)
    );

    await interaction.editReply({
      embeds: [embed],
      components: [selectMenu],
    });
  } catch (err) {
    console.error('[Controller] Media resolution error:', err);
    await interaction.editReply(`❌ Failed to search media: ${(err as Error).message}`);
  }
}

/**
 * Handle Component Interactions (Buttons, Select Menus)
 */
export async function handleComponentInteraction(
  interaction: ButtonInteraction | StringSelectMenuInteraction
): Promise<void> {
  const { customId, guildId } = interaction;
  if (!guildId) return;

  // Handle Search Result Dropdown
  if (customId.startsWith('search_select:')) {
    await interaction.deferUpdate().catch(() => {});
    const searchId = customId.split(':')[1];
    const cached = pendingSearches.get(searchId);
    if (!cached) {
      await interaction.followUp({ content: '❌ Search expired, please run `/movie` again.', ephemeral: true });
      return;
    }

    const selectInter = interaction as StringSelectMenuInteraction;
    const selectedIdx = parseInt(selectInter.values[0].replace('item_', ''), 10);
    const media = cached.mediaItems[selectedIdx];
    const initialQuality = cached.initialQuality || '720p';
    pendingSearches.delete(searchId);

    const voiceChannel = (interaction.member as GuildMember)?.voice?.channel;
    if (!voiceChannel) {
      await interaction.followUp({ content: '⚠️ Please join a voice channel first.', ephemeral: true });
      return;
    }

    await startMediaPlayback(selectInter, media, voiceChannel.id, undefined, initialQuality);
    return;
  }

  // Handle Subtitle Selection Menu
  if (customId === 'player:select_subtitle') {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const selectInter = interaction as StringSelectMenuInteraction;
    const selectedLang = selectInter.values[0];
    const res = await ipcClient.sendCommand(guildId, 'SET_SUBTITLE', { language: selectedLang });
    if (res.success) {
      await selectInter.editReply(`💬 Subtitle track set to: **${selectedLang}**`);
      await refreshPlayerMessage(guildId);
    } else {
      await selectInter.editReply(`❌ Failed to set subtitle: ${res.error || 'Worker unavailable'}`);
    }
    return;
  }

  // Handle Subtitle Delay Button Adjustments
  if (customId.startsWith('player:subdelay:')) {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const deltaStr = customId.replace('player:subdelay:', '');
    const stateRes = await ipcClient.sendCommand(guildId, 'GET_STATE');
    const currentDelay = stateRes.state?.subtitleDelay || 0;
    const newDelay = deltaStr === '0.0' ? 0 : Math.round((currentDelay + parseFloat(deltaStr)) * 10) / 10;
    const res = await ipcClient.sendCommand(guildId, 'SET_SUBTITLE_DELAY', { delaySeconds: newDelay });
    if (res.success) {
      await interaction.editReply(`💬 Subtitle delay set to: **${newDelay > 0 ? `+${newDelay}` : newDelay}s**`);
      await refreshPlayerMessage(guildId);
    } else {
      await interaction.editReply(`❌ Failed to adjust subtitle delay: ${res.error || 'Worker unavailable'}`);
    }
    return;
  }

  // Handle Quality Selection Menu
  if (customId === 'player:select_quality') {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const selectInter = interaction as StringSelectMenuInteraction;
    const selectedQuality = selectInter.values[0];
    const res = await ipcClient.sendCommand(guildId, 'SET_QUALITY', { quality: selectedQuality });
    if (res.success) {
      await selectInter.editReply(`⚙️ Stream quality updated to: **${selectedQuality.toUpperCase()}**`);
      await refreshPlayerMessage(guildId);
    } else {
      await selectInter.editReply(`❌ Failed to set quality: ${res.error || 'Worker unavailable'}`);
    }
    return;
  }

  // Handle Audio Selection Menu
  if (customId === 'player:select_audio') {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});
    const selectInter = interaction as StringSelectMenuInteraction;
    const selectedAudio = selectInter.values[0];
    const res = await ipcClient.sendCommand(guildId, 'SET_AUDIO', { trackId: selectedAudio });
    if (res.success) {
      await selectInter.editReply(`🔊 Audio track updated.`);
      await refreshPlayerMessage(guildId);
    } else {
      await selectInter.editReply(`❌ Failed to set audio: ${res.error || 'Worker unavailable'}`);
    }
    return;
  }

  // Handle Playback Buttons
  switch (customId) {
    case 'player:pause': {
      await interaction.deferUpdate().catch(() => {});
      const res = await ipcClient.sendCommand(guildId, 'PAUSE');
      if (res.state) {
        const embed = createPlayerEmbed(res.state);
        const rows = createPlayerControlRows(res.state);
        await interaction.editReply({ embeds: [embed], components: rows }).catch(() => {});
      }
      break;
    }
    case 'player:resume': {
      await interaction.deferUpdate().catch(() => {});
      const res = await ipcClient.sendCommand(guildId, 'RESUME');
      if (res.state) {
        const embed = createPlayerEmbed(res.state);
        const rows = createPlayerControlRows(res.state);
        await interaction.editReply({ embeds: [embed], components: rows }).catch(() => {});
      }
      break;
    }
    case 'player:forward': {
      await interaction.deferUpdate().catch(() => {});
      const res = await ipcClient.sendCommand(guildId, 'FORWARD', { seconds: 10 });
      if (res.state) {
        const embed = createPlayerEmbed(res.state);
        const rows = createPlayerControlRows(res.state);
        await interaction.editReply({ embeds: [embed], components: rows }).catch(() => {});
      }
      break;
    }
    case 'player:rewind': {
      await interaction.deferUpdate().catch(() => {});
      const res = await ipcClient.sendCommand(guildId, 'REWIND', { seconds: 10 });
      if (res.state) {
        const embed = createPlayerEmbed(res.state);
        const rows = createPlayerControlRows(res.state);
        await interaction.editReply({ embeds: [embed], components: rows }).catch(() => {});
      }
      break;
    }
    case 'player:stop': {
      await interaction.deferUpdate().catch(() => {});
      await ipcClient.sendCommand(guildId, 'STOP');
      await sessionStore.deleteSession(guildId);
      activePlayerMessages.delete(guildId);
      await interaction.editReply({ content: '⏹️ Playback stopped.', embeds: [], components: [] }).catch(() => {});
      break;
    }
    case 'player:menu_subtitles': {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const stateRes = await ipcClient.sendCommand(guildId, 'GET_STATE');
      if (stateRes.state) {
        const rows = createSubtitleControlRows(
          stateRes.state.subtitles || [],
          stateRes.state.activeSubtitle,
          stateRes.state.subtitleDelay || 0
        );
        await interaction.editReply({
          content: `💬 **Subtitle Tracks & Timing Sync** (Current Delay: \`${stateRes.state.subtitleDelay || 0}s\`):`,
          components: rows,
        });
      } else {
        await interaction.editReply({ content: 'ℹ️ No active player state.' });
      }
      break;
    }
    case 'player:menu_quality': {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const stateRes = await ipcClient.sendCommand(guildId, 'GET_STATE');
      if (stateRes.state) {
        const row = createQualitySelectMenu(stateRes.state.resolution);
        await interaction.editReply({ content: '⚙️ Select Stream Resolution / Quality:', components: [row] });
      } else {
        await interaction.editReply({ content: 'ℹ️ No active player state.' });
      }
      break;
    }
    case 'player:menu_audio': {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const stateRes = await ipcClient.sendCommand(guildId, 'GET_STATE');
      if (stateRes.state) {
        const row = createAudioSelectMenu(stateRes.state.audioTracks || [], stateRes.state.activeAudio);
        await interaction.editReply({ content: '🔊 Select Audio Track:', components: [row] });
      } else {
        await interaction.editReply({ content: 'ℹ️ No active player state.' });
      }
      break;
    }
    case 'player:menu_queue': {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      const items = await queueManager.list(guildId);
      if (items.length === 0) {
        await interaction.editReply({ content: '📜 Queue is currently empty.' });
      } else {
        const list = items.map((it, idx) => `${idx + 1}. ${it.media.name} (${it.stream?.quality || "auto"})`).join('\n');
        await interaction.editReply({ content: `📜 **Queue:**\n${list}` });
      }
      break;
    }
  }
}

export async function refreshPlayerMessage(guildId: string): Promise<void> {
  const msg = activePlayerMessages.get(guildId);
  if (!msg) return;
  try {
    const stateRes = await ipcClient.sendCommand(guildId, 'GET_STATE');
    if (stateRes.success && stateRes.state) {
      const embed = createPlayerEmbed(stateRes.state);
      const rows = createPlayerControlRows(stateRes.state);
      await msg.edit({ embeds: [embed], components: rows });
    }
  } catch {
    // Suppress transient discord edit errors
  }
}

async function startMediaPlayback(
  interaction: any,
  media: MediaItem,
  voiceChannelId: string,
  preselectedStream?: MediaStream,
  initialQuality: string = '720p'
): Promise<void> {
  const guildId = interaction.guildId;

  let selectedStream = preselectedStream;
  if (!selectedStream) {
    const editFn = interaction.editReply ? interaction.editReply.bind(interaction) : interaction.reply.bind(interaction);
    await editFn({ content: `🔍 Resolving ${initialQuality.toUpperCase()} streams for **"${media.name}"**...`, embeds: [], components: [] });

    console.log(`[Controller] Resolving streams for "${media.name}" (${media.imdbId}, Preferred: ${initialQuality})...`);
    const streams = await resolveMediaStreams(media.type, media.imdbId, undefined, undefined, initialQuality);

    if (streams.length === 0) {
      await interaction.editReply(`❌ No playback streams found for **"${media.name}"**.`);
      return;
    }

    selectedStream = streams[0];
  }

  const editFn = interaction.editReply ? interaction.editReply.bind(interaction) : interaction.reply.bind(interaction);
  await editFn({
    content: `🎬 Preparing stream (${initialQuality.toUpperCase()}) for **"${media.name}"** in <#${voiceChannelId}>...`,
    embeds: [],
    components: [],
  });

  console.log(`[Controller] Dispatching OPEN_MEDIA to Stream Worker (Voice Channel: ${voiceChannelId}, Quality: ${initialQuality})...`);
  const workerRes = await ipcClient.sendCommand(
    guildId,
    'OPEN_MEDIA',
    {
      streamUrl: selectedStream.url,
      title: media.name,
      imdbId: media.imdbId,
      type: media.type,
      quality: initialQuality,
      voiceChannelId,
      textChannelId: interaction.channelId,
    },
    voiceChannelId,
    interaction.channelId
  );

  if (!workerRes.success || !workerRes.state) {
    await interaction.editReply(`❌ Worker failed to start stream: ${workerRes.error || 'Unknown error'}`);
    return;
  }

  const embed = createPlayerEmbed(workerRes.state);
  const rows = createPlayerControlRows(workerRes.state);

  const playerMessage = await interaction.editReply({
    content: `🎬 Now Streaming **${media.name}** in <#${voiceChannelId}>!`,
    embeds: [embed],
    components: rows,
  });

  if (playerMessage instanceof Message) {
    activePlayerMessages.set(guildId, playerMessage);
  }
}

function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return 0;
}
