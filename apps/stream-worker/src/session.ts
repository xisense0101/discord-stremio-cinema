import fs from 'fs';
import { Streamer, prepareStream, playStream, Utils, Encoders } from '@dank074/discord-video-stream';
import { PlayerState, SubtitleTrack, AudioTrack } from '@discord-stremio/playback';
import {
  fetchAvailableSubtitles,
  downloadSubtitleFile,
  probeEmbeddedSubtitles,
  extractEmbeddedSubtitle,
  probeEmbeddedAudioTracks,
  SubtitleTrackInfo,
  AudioTrackInfo,
} from '@discord-stremio/metadata';
import config from '@discord-stremio/config';

export class WorkerGuildSession {
  public readonly guildId: string;
  public voiceChannelId: string | null = null;
  public textChannelId: string | null = null;
  public streamer: Streamer;
  public isStreaming: boolean = false;

  private currentTitle: string = 'No Media Loaded';
  private currentStreamUrl: string = '';
  private resolvedCdnUrl: string = '';
  private currentPosition: number = 0;
  private currentImdbId?: string;
  private duration: number = 7200;
  private playbackStatus: 'IDLE' | 'BUFFERING' | 'PLAYING' | 'PAUSED' | 'ENDED' | 'ERROR' | 'INTERMISSION' = 'IDLE';
  private intermissionRemaining: number = 0;
  private intermissionTimer: NodeJS.Timeout | null = null;

  private activeSubtitle: string = 'Off';
  private activeSubtitlePath: string | null = null;
  private subtitleDelaySeconds: number = 0;
  private availableSubtitlesMap: Map<string, SubtitleTrackInfo> = new Map();
  private subtitles: SubtitleTrack[] = [];

  private currentQuality: string = '720p';
  private qualityLabel: string = '720p HD';
  private streamWidth: number = 1280;
  private streamHeight: number = 720;
  private streamBitrateKbps: number = 2500;
  private streamMaxBitrateKbps: number = 2500;

  private activeAudioStreamIndex: number = 0;
  private activeAudio: string = 'Default Audio';
  private audioTracks: AudioTrack[] = [
    { id: '0', label: 'Default Stereo Audio', language: 'en', enabled: true },
  ];

  private activeFfmpegCommand: any = null;
  private progressInterval: NodeJS.Timeout | null = null;
  private isVoiceConnected: boolean = false;

  constructor(guildId: string, streamer: Streamer) {
    this.guildId = guildId;
    this.streamer = streamer;
  }

  public setVoiceChannel(vcId: string): void {
    this.voiceChannelId = vcId;
    this.isVoiceConnected = true;
  }

  /**
   * Follow HTTP 302/307 redirects or query TorBox API directly for direct video CDN endpoint
   */
  private async resolveFinalStreamUrl(rawUrl: string): Promise<string> {
    try {
      // 1. If it is a TorBox torrentio redirect URL or magnet link or raw infoHash, resolve via direct TorBox CDN
      const magnetMatch = rawUrl.match(/btih:([a-fA-F0-9]{40})/i) || rawUrl.match(/\/([a-fA-F0-9]{40})/);
      if (magnetMatch || rawUrl.includes('torrentio.strem.fun/resolve/torbox/')) {
        const infoHash = magnetMatch ? magnetMatch[1] : rawUrl.split('/').find((p) => /^[a-fA-F0-9]{40}$/i.test(p));
        if (infoHash) {
          console.log(`[WorkerSession:${this.guildId}] Resolving direct TorBox CDN link for infoHash: ${infoHash}...`);
          const { torboxResolver } = await import('@discord-stremio/metadata');
          const directStream = await torboxResolver.resolveDirectTorboxStream(infoHash);
          if (directStream && directStream.url && directStream.url.startsWith('http')) {
            console.log(`[WorkerSession:${this.guildId}] Successfully resolved direct TorBox video CDN: ${directStream.url.split('?')[0]}`);
            return directStream.url;
          }
        }
      }

      // 2. Standard HTTP redirect resolution with browser user-agent
      if (rawUrl.startsWith('http')) {
        console.log(`[WorkerSession:${this.guildId}] Resolving stream URL redirect chain...`);
        const res = await fetch(rawUrl, {
          method: 'HEAD',
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(8000),
        });

        if (res.url && res.url.includes('slate.elfhosted.com')) {
          console.warn(`[WorkerSession:${this.guildId}] Detected ElfHosted Slate IP-lock redirect (${res.url.substring(0, 80)}...). Fallback to direct resolution...`);
          if (this.currentImdbId) {
            const { torboxResolver } = await import('@discord-stremio/metadata');
            const directStreams = await torboxResolver.resolveStreams('movie', this.currentImdbId, undefined, undefined, '720p');
            if (directStreams && directStreams.length > 0 && directStreams[0].url) {
              console.log(`[WorkerSession:${this.guildId}] Slate bypassed: Using direct stream "${directStreams[0].title}"`);
              return directStreams[0].url;
            }
          }
        } else if (res.url && res.url.startsWith('http')) {
          console.log(`[WorkerSession:${this.guildId}] Resolved CDN endpoint: ${res.url.split('?')[0]}`);
          return res.url;
        }
      }
    } catch (err) {
      console.warn(`[WorkerSession:${this.guildId}] Direct URL resolution notice:`, (err as Error).message);
    }
    return rawUrl;
  }

  async openMedia(options: {
    streamUrl: string;
    title: string;
    imdbId?: string;
    type?: 'movie' | 'series';
    season?: number;
    episode?: number;
    quality?: string;
    voiceChannelId: string;
    textChannelId?: string;
    initialTime?: number;
  }): Promise<PlayerState> {
    this.voiceChannelId = options.voiceChannelId;
    this.textChannelId = options.textChannelId || null;
    this.currentTitle = options.title;
    this.currentImdbId = options.imdbId;
    this.currentPosition = options.initialTime || 0;
    this.subtitleDelaySeconds = 0;
    this.playbackStatus = 'BUFFERING';

    this.configureQuality(options.quality || '720p');
    console.log(`[WorkerSession:${this.guildId}] Opening media: "${this.currentTitle}" (Quality: ${this.qualityLabel})`);

    // Ensure playback URL is always resolved from Worker IP to avoid ElfHosted IP-lock mismatches
    let streamUrlToUse = options.streamUrl;
    if (options.imdbId) {
      try {
        console.log(`[WorkerSession:${this.guildId}] Resolving fresh stream URL from Worker IP for ${options.type || 'movie'} ${options.imdbId}...`);
        const { resolveMediaStreams } = await import('@discord-stremio/metadata');
        const streams = await resolveMediaStreams(
          options.type || 'movie',
          options.imdbId,
          options.season,
          options.episode,
          options.quality || '720p'
        );
        if (streams && streams.length > 0) {
          streamUrlToUse = streams[0].url;
          console.log(`[WorkerSession:${this.guildId}] Worker IP stream resolved: "${streams[0].title}" (${streams[0].quality})`);
        }
      } catch (err) {
        console.warn(`[WorkerSession:${this.guildId}] Worker IP stream resolution notice:`, (err as Error).message);
      }
    }

    this.currentStreamUrl = streamUrlToUse;

    const targetVc = options.voiceChannelId || this.voiceChannelId;
    if (targetVc) {
      const currentConnectedVc = (this.streamer as any).voiceConnection?.channelId;
      const isVoiceConnected = (this.streamer as any).voiceConnection && currentConnectedVc === targetVc;

      if (!isVoiceConnected) {
        this.voiceChannelId = targetVc;
        try {
          console.log(`[WorkerSession:${this.guildId}] Connecting to voice channel ${this.voiceChannelId}...`);
          await this.streamer.joinVoice(this.guildId, this.voiceChannelId);
          this.isVoiceConnected = true;
          console.log(`[WorkerSession:${this.guildId}] Voice channel connected.`);
        } catch (err) {
          console.warn(`[WorkerSession:${this.guildId}] Voice join notice:`, (err as Error).message);
        }
      } else {
        this.voiceChannelId = targetVc;
        this.isVoiceConnected = true;
        console.log(`[WorkerSession:${this.guildId}] Active in voice channel ${targetVc}`);
      }
    }

    // 1. Resolve direct CDN URL first to give ffprobe instant zero-latency access
    this.resolvedCdnUrl = await this.resolveFinalStreamUrl(streamUrlToUse);
    const probeTargetUrl = this.resolvedCdnUrl || streamUrlToUse;

    // 2. Run embedded subtitle discovery, embedded audio discovery, external subtitle fetching in parallel
    const [rawExternalSubs, embeddedSubs, probedAudioTracks] = await Promise.all([
      options.imdbId
        ? fetchAvailableSubtitles(options.imdbId, options.type || 'movie').catch(() => [] as SubtitleTrackInfo[])
        : Promise.resolve([] as SubtitleTrackInfo[]),
      probeEmbeddedSubtitles(probeTargetUrl).catch(() => [] as SubtitleTrackInfo[]),
      probeEmbeddedAudioTracks(probeTargetUrl, 5000).catch(() => [] as AudioTrackInfo[]),
    ]);

    // Load multi-language Audio Tracks & auto-select English
    if (probedAudioTracks && probedAudioTracks.length > 0) {
      this.audioTracks = probedAudioTracks.map((a: AudioTrackInfo) => ({
        id: String(a.audioStreamIndex),
        label: a.label,
        language: a.language,
        enabled: false,
      }));

      // Default to Track 0 (Original Audio / Main Dialogue in container) unless Track 0 is a commentary track
      let defaultTrackIndex = 0;
      const isCommentary = (label: string) => {
        const l = label.toLowerCase();
        return l.includes('commentary') || l.includes('description') || l.includes('director');
      };
      if (isCommentary(this.audioTracks[0]?.label || '')) {
        const nonCommentary = this.audioTracks.findIndex((t) => !isCommentary(t.label));
        if (nonCommentary >= 0) defaultTrackIndex = nonCommentary;
      }

      this.activeAudioStreamIndex = defaultTrackIndex;
      this.audioTracks[this.activeAudioStreamIndex].enabled = true;
      this.activeAudio = this.audioTracks[this.activeAudioStreamIndex]?.label || 'Default Audio';
      console.log(`[WorkerSession:${this.guildId}] Discovered ${this.audioTracks.length} audio tracks. Active: "${this.activeAudio}" [0:a:${this.activeAudioStreamIndex}]`);
    } else {
      this.audioTracks = [{ id: '0', label: 'Default Stereo Audio (English)', language: 'en', enabled: true }];
      this.activeAudioStreamIndex = 0;
      this.activeAudio = 'Default Stereo Audio (English)';
    }

    this.availableSubtitlesMap.clear();
    this.subtitles = [];
    this.activeSubtitle = 'Off';
    this.activeSubtitlePath = null;

    // Combine Tier 1 (Embedded) and Tier 2 (External) subtitles
    const allSubs: SubtitleTrackInfo[] = [...embeddedSubs, ...rawExternalSubs];

    if (allSubs.length > 0) {
      allSubs.forEach((sub, idx) => {
        this.availableSubtitlesMap.set(sub.lang.toLowerCase(), sub);
        this.subtitles.push({
          id: String(idx + 1),
          label: sub.lang,
          language: sub.lang,
          kind: 'subtitles',
          active: false,
        });
      });
      console.log(`[WorkerSession:${this.guildId}] Loaded ${allSubs.length} subtitle tracks (${embeddedSubs.length} embedded, ${rawExternalSubs.length} external).`);

      // Auto-select English subtitles by default
      const enSub = rawExternalSubs.find((s) => {
        const l = s.lang.toLowerCase();
        return l === 'english' || l === 'en' || l.startsWith('en-') || l.includes('english');
      }) || allSubs.find((s) => s.lang.toLowerCase().includes('english'));

      if (enSub) {
        const targetPath = `/tmp/sub_${this.guildId}.srt`;
        console.log(`[WorkerSession:${this.guildId}] Auto-selecting English subtitle track (${enSub.lang})...`);
        let downloaded = false;
        if (enSub.url) {
          downloaded = await downloadSubtitleFile(enSub.url, targetPath);
        } else if (enSub.isEmbedded && enSub.streamIndex !== undefined) {
          downloaded = await extractEmbeddedSubtitle(this.resolvedCdnUrl || this.currentStreamUrl, enSub.streamIndex, targetPath);
        }

        if (downloaded && fs.existsSync(targetPath)) {
          this.activeSubtitle = enSub.lang;
          this.activeSubtitlePath = targetPath;
          this.subtitles.forEach((s) => {
            s.active = s.label.toLowerCase() === enSub!.lang.toLowerCase();
          });
          console.log(`[WorkerSession:${this.guildId}] Auto-loaded English subtitle cached at ${targetPath}`);
        }
      }
    }

    // 2. Start high-performance streaming segment
    await this.startStreamSegment(this.currentPosition);

    return this.getState();
  }

  private async startStreamSegment(seekSeconds: number = 0): Promise<void> {
    // Terminate previous FFmpeg process and stop previous Go-Live packetizer
    if (this.activeFfmpegCommand) {
      try {
        this.activeFfmpegCommand.kill('SIGKILL');
      } catch {}
      this.activeFfmpegCommand = null;
    }

    try {
      this.streamer.stopStream();
    } catch {}

    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }

    const encoder = Encoders.software({
      x264: {
        preset: 'ultrafast',
        tune: 'zerolatency',
      },
    });

    console.log(
      `[WorkerSession:${this.guildId}] Starting stream segment (${this.qualityLabel}, Audio: "${this.activeAudio}" [0:a:${this.activeAudioStreamIndex}], Seek: ${seekSeconds}s, Subtitles: "${this.activeSubtitle}")...`
    );

    const customInputOptions: string[] = [
      ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
      '-reconnect', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-probesize', '15M',
      '-analyzeduration', '15M',
      '-threads', '4',
    ];

    // Single unified filtergraph for video (scaling + subtitle rendering)
    const vfFilters: string[] = [];

    if (this.activeSubtitle !== 'Off' && this.activeSubtitlePath && fs.existsSync(this.activeSubtitlePath)) {
      // Offset PTS by seekSeconds minus subtitleDelaySeconds for frame-accurate timing
      const effectiveTime = Math.max(0, seekSeconds - this.subtitleDelaySeconds);
      const subFilter = (seekSeconds > 0 || this.subtitleDelaySeconds !== 0)
        ? `setpts=PTS+${effectiveTime}/TB,subtitles=${this.activeSubtitlePath}:force_style='FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=1.2,Shadow=0.5,MarginV=25',setpts=PTS-STARTPTS`
        : `subtitles=${this.activeSubtitlePath}:force_style='FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=1.2,Shadow=0.5,MarginV=25'`;

      vfFilters.push(subFilter);
      console.log(`[WorkerSession:${this.guildId}] Unified subtitle filter active (${this.activeSubtitle} at effective seek ${effectiveTime}s): ${this.activeSubtitlePath}`);
    }

    // Custom audio mapping + filtering: dialogue matrix + volume boost
    const customFfmpegFlags: string[] = [
      '-threads', '4',
      '-filter_threads', '4',
      '-b:v', `${this.streamBitrateKbps}k`,
      '-maxrate:v', `${this.streamBitrateKbps}k`,
      '-bufsize:v', `${this.streamBitrateKbps}k`,
      '-map', '0:v:0',
      '-map', `0:a:${this.activeAudioStreamIndex}?`,
      '-af', 'volume=1.4,pan=stereo|c0=c2+0.6*c0+0.6*c4|c1=c2+0.6*c1+0.6*c5',
    ];

    if (vfFilters.length > 0) {
      customFfmpegFlags.push('-vf', vfFilters.join(','));
    }

    const { command, output } = prepareStream(this.resolvedCdnUrl, {
      encoder,
      width: this.streamWidth,
      height: this.streamHeight,
      frameRate: config.stream.fps,
      bitrateVideo: this.streamBitrateKbps,
      bitrateVideoMax: this.streamMaxBitrateKbps,
      bitrateAudio: config.stream.audioBitrateKbps,
      videoCodec: Utils.normalizeVideoCodec('H264'),
      includeAudio: true,
      customInputOptions,
      customFfmpegFlags,
    });

    this.activeFfmpegCommand = command;
    this.playbackStatus = 'PLAYING';
    this.isStreaming = true;

    // Synchronize: wait until output has header bytes ready before demuxing
    await new Promise<void>((resolve, reject) => {
      command.once('error', reject);
      if (output.readableLength > 0) return resolve();
      output.once('readable', () => resolve());
    });

    // Track playback clock
    this.currentPosition = seekSeconds;
    this.progressInterval = setInterval(() => {
      if (this.playbackStatus === 'PLAYING') {
        this.currentPosition += 1;
      }
    }, 1000);

    const streamStartTime = Date.now();

    command.on('error', (err: any) => {
      console.warn(`[WorkerSession:${this.guildId}] FFmpeg notice:`, err.message);
      if (this.activeFfmpegCommand === command) {
        this.playbackStatus = 'ERROR';
      }
    });

    command.on('end', () => {
      if (this.activeFfmpegCommand !== command) return;
      const elapsedSeconds = (Date.now() - streamStartTime) / 1000;
      console.log(`[WorkerSession:${this.guildId}] Stream segment ended (runtime: ${elapsedSeconds.toFixed(1)}s).`);
      // Only trigger media finished if stream ran for substantial duration or reached end
      if (elapsedSeconds > 15 || this.currentPosition > 30) {
        this.handleMediaFinished();
      } else {
        console.warn(`[WorkerSession:${this.guildId}] Early stream termination detected. Retaining voice connection.`);
        this.playbackStatus = 'IDLE';
      }
    });

    playStream(output, this.streamer, {
      type: 'go-live',
    }).catch((err) => {
      console.warn(`[WorkerSession:${this.guildId}] playStream notice:`, err.message);
    });
  }

  async pause(): Promise<void> {
    if (this.playbackStatus === 'PLAYING') {
      this.playbackStatus = 'PAUSED';
      if (this.activeFfmpegCommand && this.activeFfmpegCommand.ffmpegProc && this.activeFfmpegCommand.ffmpegProc.pid) {
        try {
          process.kill(this.activeFfmpegCommand.ffmpegProc.pid, 'SIGSTOP');
          console.log(`[WorkerSession:${this.guildId}] Paused FFmpeg (SIGSTOP).`);
        } catch (err) {
          console.warn('[WorkerSession] Pause notice:', (err as Error).message);
        }
      }
    }
  }

  async resume(): Promise<void> {
    if (this.playbackStatus === 'PAUSED') {
      this.playbackStatus = 'PLAYING';
      if (this.activeFfmpegCommand && this.activeFfmpegCommand.ffmpegProc && this.activeFfmpegCommand.ffmpegProc.pid) {
        try {
          process.kill(this.activeFfmpegCommand.ffmpegProc.pid, 'SIGCONT');
          console.log(`[WorkerSession:${this.guildId}] Resumed FFmpeg (SIGCONT).`);
        } catch (err) {
          console.warn('[WorkerSession] Resume notice:', (err as Error).message);
        }
      }
    }
  }

  async seek(seconds: number): Promise<void> {
    console.log(`[WorkerSession:${this.guildId}] Seeking to ${seconds}s...`);
    this.currentPosition = Math.max(0, seconds);
    await this.startStreamSegment(this.currentPosition);
  }

  async forward(seconds: number = 10): Promise<void> {
    await this.seek(this.currentPosition + seconds);
  }

  async rewind(seconds: number = 10): Promise<void> {
    await this.seek(Math.max(0, this.currentPosition - seconds));
  }

  async setSubtitle(languageOrLabel: string): Promise<boolean> {
    const isOff = languageOrLabel.toLowerCase() === 'off' || languageOrLabel.toLowerCase() === 'none';

    if (isOff) {
      this.activeSubtitle = 'Off';
      this.activeSubtitlePath = null;
      console.log(`[WorkerSession:${this.guildId}] Subtitles disabled.`);
    } else {
      const subInfo = this.availableSubtitlesMap.get(languageOrLabel.toLowerCase());
      if (subInfo) {
        const targetPath = `/tmp/sub_${this.guildId}.srt`;
        console.log(`[WorkerSession:${this.guildId}] Preparing subtitle track: "${subInfo.lang}"...`);

        let ready = false;
        if (subInfo.isEmbedded && subInfo.streamIndex !== undefined) {
          ready = await extractEmbeddedSubtitle(this.currentStreamUrl, subInfo.streamIndex, targetPath);
        } else if (subInfo.url) {
          ready = await downloadSubtitleFile(subInfo.url, targetPath);
        }

        if (ready && fs.existsSync(targetPath)) {
          this.activeSubtitle = subInfo.lang;
          this.activeSubtitlePath = targetPath;
          console.log(`[WorkerSession:${this.guildId}] Subtitle cached at ${targetPath}`);
        } else {
          console.warn(`[WorkerSession:${this.guildId}] Failed to prepare subtitle track.`);
          return false;
        }
      } else {
        this.activeSubtitle = languageOrLabel;
      }
    }

    this.subtitles.forEach((s) => {
      s.active = s.label.toLowerCase() === this.activeSubtitle.toLowerCase();
    });

    if (this.isStreaming) {
      console.log(`[WorkerSession:${this.guildId}] Reloading stream with subtitle "${this.activeSubtitle}" at ${this.currentPosition}s...`);
      await this.startStreamSegment(this.currentPosition);
    }

    return true;
  }

  async setSubtitleDelay(delaySeconds: number): Promise<boolean> {
    this.subtitleDelaySeconds = Math.round(delaySeconds * 10) / 10;
    console.log(`[WorkerSession:${this.guildId}] Subtitle delay set to: ${this.subtitleDelaySeconds}s`);

    if (this.isStreaming && this.activeSubtitle !== 'Off') {
      console.log(`[WorkerSession:${this.guildId}] Applying subtitle delay ${this.subtitleDelaySeconds}s at ${this.currentPosition}s...`);
      await this.startStreamSegment(this.currentPosition);
    }

    return true;
  }

  private configureQuality(quality: string): void {
    const q = quality.toLowerCase().trim();
    if (q === '4k' || q === '2160p' || q === 'uhd') {
      this.currentQuality = '4k';
      this.qualityLabel = '4K UHD (2160p)';
      this.streamWidth = 3840;
      this.streamHeight = 2160;
      this.streamBitrateKbps = 12000;
      this.streamMaxBitrateKbps = 15000;
    } else if (q === '2k' || q === '1440p' || q === 'qhd') {
      this.currentQuality = '2k';
      this.qualityLabel = '2K QHD (1440p)';
      this.streamWidth = 2560;
      this.streamHeight = 1440;
      this.streamBitrateKbps = 8000;
      this.streamMaxBitrateKbps = 10000;
    } else if (q === '1080p' || q === 'fhd') {
      this.currentQuality = '1080p';
      this.qualityLabel = '1080p FHD';
      this.streamWidth = 1920;
      this.streamHeight = 1080;
      this.streamBitrateKbps = 4500;
      this.streamMaxBitrateKbps = 4500;
    } else if (q === '480p' || q === 'sd') {
      this.currentQuality = '480p';
      this.qualityLabel = '480p SD';
      this.streamWidth = 854;
      this.streamHeight = 480;
      this.streamBitrateKbps = 1200;
      this.streamMaxBitrateKbps = 1800;
    } else {
      // Default 720p HD
      this.currentQuality = '720p';
      this.qualityLabel = '720p HD';
      this.streamWidth = 1280;
      this.streamHeight = 720;
      this.streamBitrateKbps = 2500;
      this.streamMaxBitrateKbps = 2500;
    }
  }

  async setQuality(quality: string): Promise<boolean> {
    this.configureQuality(quality);
    console.log(`[WorkerSession:${this.guildId}] Stream quality set to: ${this.qualityLabel} (${this.streamWidth}x${this.streamHeight} @ ${this.streamBitrateKbps} kbps)`);

    if (this.isStreaming) {
      console.log(`[WorkerSession:${this.guildId}] Applying quality ${this.qualityLabel} at ${this.currentPosition}s...`);
      await this.startStreamSegment(this.currentPosition);
    }

    return true;
  }

  async setAudio(trackId: string | number): Promise<boolean> {
    const trackIdx = parseInt(String(trackId), 10);
    if (!isNaN(trackIdx) && trackIdx >= 0) {
      this.activeAudioStreamIndex = trackIdx;
      const matchedTrack = this.audioTracks.find((t) => t.id === String(trackIdx));
      this.activeAudio = matchedTrack?.label || `Audio Track #${trackIdx + 1}`;
    } else {
      // Search by label or language
      const matchedTrack = this.audioTracks.find(
        (t) =>
          t.label.toLowerCase() === String(trackId).toLowerCase() ||
          t.language.toLowerCase() === String(trackId).toLowerCase()
      );
      if (matchedTrack) {
        this.activeAudioStreamIndex = parseInt(matchedTrack.id, 10) || 0;
        this.activeAudio = matchedTrack.label;
      } else {
        this.activeAudio = String(trackId);
      }
    }

    this.audioTracks.forEach((t) => {
      t.enabled = t.id === String(this.activeAudioStreamIndex);
    });

    console.log(`[WorkerSession:${this.guildId}] Audio track switched to: "${this.activeAudio}" (Stream Index: 0:a:${this.activeAudioStreamIndex})`);

    if (this.isStreaming) {
      console.log(`[WorkerSession:${this.guildId}] Reloading stream with audio track ${this.activeAudioStreamIndex} at ${this.currentPosition}s...`);
      await this.startStreamSegment(this.currentPosition);
    }

    return true;
  }

  private async handleMediaFinished(): Promise<void> {
    try {
      const { queueManager } = await import('@discord-stremio/queue');
      const queueSize = await queueManager.size(this.guildId);

      if (queueSize > 0) {
        console.log(`[WorkerSession:${this.guildId}] Media finished. Starting 2-minute intermission break before next queue item (${queueSize} remaining)...`);
        this.playbackStatus = 'INTERMISSION';
        this.intermissionRemaining = 120; // 2 minutes

        if (this.intermissionTimer) clearInterval(this.intermissionTimer);

        this.intermissionTimer = setInterval(async () => {
          this.intermissionRemaining -= 1;
          if (this.intermissionRemaining <= 0) {
            if (this.intermissionTimer) clearInterval(this.intermissionTimer);
            this.intermissionTimer = null;
            await this.playNextInQueue();
          }
        }, 1000);
      } else {
        console.log(`[WorkerSession:${this.guildId}] Queue is empty. Playback ended.`);
        this.playbackStatus = 'ENDED';
      }
    } catch (err) {
      console.error(`[WorkerSession:${this.guildId}] Error handling media finished:`, err);
      this.playbackStatus = 'ENDED';
    }
  }

  private async playNextInQueue(): Promise<void> {
    try {
      const { queueManager } = await import('@discord-stremio/queue');
      const nextItem = await queueManager.dequeue(this.guildId);

      if (nextItem && nextItem.stream && nextItem.stream.url) {
        console.log(`[WorkerSession:${this.guildId}] Auto-playing next queue item: "${nextItem.media.name}"...`);
        await this.openMedia({
          streamUrl: nextItem.stream.url,
          title: nextItem.media.name,
          imdbId: nextItem.media.imdbId,
          type: nextItem.media.type || 'movie',
          quality: nextItem.stream.quality || this.currentQuality,
          voiceChannelId: this.voiceChannelId || '',
          textChannelId: this.textChannelId || undefined,
        });
      } else {
        this.playbackStatus = 'ENDED';
      }
    } catch (err) {
      console.error(`[WorkerSession:${this.guildId}] Error playing next queue item:`, err);
      this.playbackStatus = 'ENDED';
    }
  }

  async skipIntermission(): Promise<void> {
    console.log(`[WorkerSession:${this.guildId}] Skipping intermission break...`);
    await this.playNextInQueue();
  }

  async getState(): Promise<PlayerState> {
    return {
      status: this.playbackStatus,
      title: this.currentTitle,
      currentTime: this.currentPosition,
      duration: this.duration,
      bufferedTime: this.currentPosition + 30,
      subtitles: this.subtitles.length > 0 ? this.subtitles : [
        { id: '1', label: 'English', language: 'en', kind: 'subtitles', active: this.activeSubtitle === 'English' },
        { id: '2', label: 'Spanish', language: 'es', kind: 'subtitles', active: this.activeSubtitle === 'Spanish' },
      ],
      activeSubtitle: this.activeSubtitle,
      subtitleDelay: this.subtitleDelaySeconds,
      intermissionRemaining: this.intermissionRemaining,
      audioTracks: this.audioTracks,
      activeAudio: this.activeAudio,
      activeAudioTrack: this.activeAudioStreamIndex,
      volume: 1,
      muted: false,
      fps: config.stream.fps,
      resolution: this.qualityLabel,
      stallCount: 0,
      updatedAt: Date.now(),
    };
  }

  async stop(): Promise<void> {
    this.isStreaming = false;
    this.isVoiceConnected = false;
    this.playbackStatus = 'IDLE';

    if (this.intermissionTimer) {
      clearInterval(this.intermissionTimer);
      this.intermissionTimer = null;
    }
    this.intermissionRemaining = 0;

    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }

    if (this.activeFfmpegCommand) {
      try {
        this.activeFfmpegCommand.kill('SIGKILL');
      } catch {}
      this.activeFfmpegCommand = null;
    }

    try {
      this.streamer.stopStream();
      this.streamer.leaveVoice();
    } catch {}

    console.log(`[WorkerSession:${this.guildId}] Stream stopped and voice channel disconnected.`);
  }
}
