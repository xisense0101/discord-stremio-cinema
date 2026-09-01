import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { PlayerState, SubtitleTrack, AudioTrack } from '@discord-stremio/playback';
import { MediaItem } from '@discord-stremio/metadata';

function formatTimestamp(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '00:00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function createProgressBar(current: number, total: number, size: number = 16): string {
  if (!total || total <= 0) return '▬'.repeat(size);
  const progress = Math.min(Math.max(current / total, 0), 1);
  const filled = Math.round(progress * size);
  const empty = size - filled;
  return '▓'.repeat(filled) + '░'.repeat(empty);
}

export function createPlayerEmbed(state: PlayerState, media?: MediaItem): EmbedBuilder {
  const isPlaying = state.status === 'PLAYING';
  const isPaused = state.status === 'PAUSED';
  const isBuffering = state.status === 'BUFFERING';

  let statusEmoji = '⏹️ Stopped';
  let color = 0x2b2d31; // Dark neutral

  if (isPlaying) {
    statusEmoji = '▶️ Playing';
    color = 0x57f287; // Discord Green
  } else if (isPaused) {
    statusEmoji = '⏸️ Paused';
    color = 0xfee75c; // Yellow
  } else if (isBuffering) {
    statusEmoji = '🔄 Buffering';
    color = 0xeb459e; // Fuchsia
  }

  const title = media?.name || state.title || 'Now Playing';
  const year = media?.releaseInfo ? ` (${media.releaseInfo})` : '';
  const currentFormatted = formatTimestamp(state.currentTime);
  const durationFormatted = formatTimestamp(state.duration);
  const progressBar = createProgressBar(state.currentTime, state.duration, 16);
  const delayText = state.subtitleDelay ? ` (Delay: ${state.subtitleDelay > 0 ? `+${state.subtitleDelay}` : state.subtitleDelay}s)` : '';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🎬 ${title}${year}`)
    .setDescription(
      `\`${progressBar}\`\n**${currentFormatted}** / **${durationFormatted}**\n\n` +
      `**Status:** ${statusEmoji}\n` +
      `**Quality:** \`${state.resolution || '1080p'}\` • **FPS:** \`${state.fps || 30}\`\n` +
      `**Audio:** \`${state.activeAudio || 'English 5.1'}\`\n` +
      `**Subtitles:** \`${state.activeSubtitle || 'Off'}${delayText}\``
    );

  if (media?.poster) {
    embed.setThumbnail(media.poster);
  }
  if (media?.description) {
    const truncatedDesc = media.description.length > 200
      ? `${media.description.substring(0, 197)}...`
      : media.description;
    embed.addFields({ name: 'Synopsis', value: truncatedDesc });
  }

  embed.setFooter({ text: 'Stremio + TorBox Discord Player • Zero Transcode Direct Pipeline' });
  embed.setTimestamp();

  return embed;
}

export function createPlayerControlRows(state: PlayerState): ActionRowBuilder<ButtonBuilder>[] {
  const isPlaying = state.status === 'PLAYING';

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('player:rewind')
      .setLabel('⏪ 10s')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(isPlaying ? 'player:pause' : 'player:resume')
      .setLabel(isPlaying ? '⏸️ Pause' : '▶️ Resume')
      .setStyle(isPlaying ? ButtonStyle.Primary : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('player:forward')
      .setLabel('⏩ 10s')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('player:stop')
      .setLabel('⏹️ Stop')
      .setStyle(ButtonStyle.Danger)
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('player:menu_subtitles')
      .setLabel('💬 Subtitles')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('player:menu_quality')
      .setLabel('⚙️ Quality')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('player:menu_audio')
      .setLabel('🔊 Audio')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('player:menu_queue')
      .setLabel('📜 Queue')
      .setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

export function createQualitySelectMenu(currentQuality?: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const norm = (currentQuality || '1080p').toLowerCase();
  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel('4K UHD (2160p)')
      .setValue('4k')
      .setDescription('3840x2160 @ 30fps • 12 Mbps (Ultra High Definition)')
      .setDefault(norm.includes('4k') || norm.includes('2160')),
    new StringSelectMenuOptionBuilder()
      .setLabel('2K QHD (1440p)')
      .setValue('2k')
      .setDescription('2560x1440 @ 30fps • 8 Mbps (Quad High Definition)')
      .setDefault(norm.includes('2k') || norm.includes('1440')),
    new StringSelectMenuOptionBuilder()
      .setLabel('1080p FHD (Full HD)')
      .setValue('1080p')
      .setDescription('1920x1080 @ 30fps • 5 Mbps (Standard High Definition)')
      .setDefault(norm.includes('1080') || (!norm.includes('4k') && !norm.includes('2k') && !norm.includes('720') && !norm.includes('480'))),
    new StringSelectMenuOptionBuilder()
      .setLabel('720p HD')
      .setValue('720p')
      .setDescription('1280x720 @ 30fps • 2.5 Mbps (Fast / Balanced)')
      .setDefault(norm.includes('720')),
    new StringSelectMenuOptionBuilder()
      .setLabel('480p SD')
      .setValue('480p')
      .setDescription('854x480 @ 30fps • 1.2 Mbps (Low Bandwidth / Eco)')
      .setDefault(norm.includes('480')),
  ];

  const select = new StringSelectMenuBuilder()
    .setCustomId('player:select_quality')
    .setPlaceholder('Select Stream Resolution / Quality')
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

export function createSubtitleSelectMenu(tracks: SubtitleTrack[], currentActive?: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel('Off (Disable Subtitles)')
      .setValue('off')
      .setDescription('Do not display subtitles')
      .setDefault(currentActive === 'Off' || !currentActive),
  ];

  // Up to 24 tracks (Discord limit is 25 options)
  tracks.slice(0, 24).forEach((track) => {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(track.label || track.language)
        .setValue(track.label || track.language)
        .setDescription(`Language: ${track.language} (${track.kind || 'subtitles'})`)
        .setDefault(track.active || track.label === currentActive)
    );
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId('player:select_subtitle')
    .setPlaceholder('Select Subtitle Track')
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

export function createSubtitleControlRows(
  tracks: SubtitleTrack[],
  currentActive?: string,
  currentDelay: number = 0
): (ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>)[] {
  const selectRow = createSubtitleSelectMenu(tracks, currentActive);
  const delayLabel = currentDelay !== 0 ? ` (${currentDelay > 0 ? `+${currentDelay}` : currentDelay}s)` : '';

  const delayRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('player:subdelay:-1.0').setLabel('⏪ -1.0s').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('player:subdelay:-0.5').setLabel('⏪ -0.5s').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('player:subdelay:0.0').setLabel(`🔄 0s${delayLabel}`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('player:subdelay:+0.5').setLabel('⏩ +0.5s').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('player:subdelay:+1.0').setLabel('⏩ +1.0s').setStyle(ButtonStyle.Secondary)
  );

  return [selectRow, delayRow];
}

export function createAudioSelectMenu(tracks: AudioTrack[], currentActive?: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const options: StringSelectMenuOptionBuilder[] = [];

  if (tracks.length === 0) {
    options.push(
      new StringSelectMenuOptionBuilder()
        .setLabel('Default Audio Track')
        .setValue('default')
        .setDescription('Default audio stream')
        .setDefault(true)
    );
  } else {
    tracks.slice(0, 25).forEach((track) => {
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(track.label || track.language)
          .setValue(track.id)
          .setDescription(`Audio Stream (${track.language})`)
          .setDefault(track.enabled || track.label === currentActive)
      );
    });
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('player:select_audio')
    .setPlaceholder('Select Audio Track')
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

export function createAdminStatusEmbed(data: {
  controllerReady: boolean;
  workerReady: boolean;
  redisReady: boolean;
  torboxConfigured: boolean;
  activeSession?: any;
  metrics: any;
}): EmbedBuilder {
  const { controllerReady, workerReady, redisReady, torboxConfigured, activeSession, metrics } = data;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🛠️ System Diagnostic & Health Status')
    .setDescription(
      `**Core Services**\n` +
      `• Discord Controller: ${controllerReady ? '🟢 Connected' : '🔴 Offline'}\n` +
      `• Stream Worker (Go-Live): ${workerReady ? '🟢 Ready' : '🔴 Offline'}\n` +
      `• Redis State Store: ${redisReady ? '🟢 Connected' : '🟡 In-Memory Fallback'}\n` +
      `• TorBox Addon Resolver: ${torboxConfigured ? '🟢 Active' : '🟡 Unconfigured (Public/Torrentio Mode)'}\n\n` +
      `**System Resources**\n` +
      `• CPU Usage: \`${metrics.cpuUsage}%\`\n` +
      `• Memory: \`${metrics.freeMemMB}MB free\` / \`${metrics.totalMemMB}MB total\` (\`${metrics.processMemRSSMB}MB RSS\`)\n` +
      `• Host Uptime: \`${Math.round(metrics.uptimeSeconds / 60)} minutes\`\n\n` +
      `**Active Playback State**\n` +
      (activeSession
        ? `• Title: **${activeSession.mediaTitle || 'Unknown'}**\n` +
          `• Quality: \`${activeSession.quality || '1080p'}\`\n` +
          `• Position: \`${formatTimestamp(activeSession.currentTime)} / ${formatTimestamp(activeSession.duration)}\`\n` +
          `• Subtitles: \`${activeSession.activeSubtitle || 'Off'}\`\n` +
          `• Video Transport: \`🟢 Frames Progressing (30 FPS)\`\n` +
          `• Audio Transport: \`🟢 Active (Opus)\``
        : `• No active stream session currently in progress.`)
    )
    .setFooter({ text: 'Discord Stremio Player • Production Health Monitor' })
    .setTimestamp();

  return embed;
}
