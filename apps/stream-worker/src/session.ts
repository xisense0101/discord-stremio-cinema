import fs from 'fs';
import { Streamer, prepareStream, playStream, Utils, Encoders } from '@dank074/discord-video-stream';
import { PlayerState, SubtitleTrack, AudioTrack } from '@discord-stremio/playback';
import {
  fetchAvailableSubtitles,
  downloadSubtitleFile,
  probeEmbeddedSubtitles,
  extractEmbeddedSubtitle,
  SubtitleTrackInfo,
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
  private duration: number = 7200;
  private playbackStatus: 'IDLE' | 'BUFFERING' | 'PLAYING' | 'PAUSED' | 'ENDED' | 'ERROR' | 'INTERMISSION' = 'IDLE';
  private intermissionRemaining: number = 0;
  private intermissionTimer: NodeJS.Timeout | null = null;

  private activeSubtitle: string = 'Off';
  private activeSubtitlePath: string | null = null;
  private subtitleDelaySeconds: number = 0;
  private availableSubtitlesMap: Map<string, SubtitleTrackInfo> = new Map();
  private subtitles: SubtitleTrack[] = [];

  private currentQuality: string = '1080p';
  private qualityLabel: string = '1080p FHD';
  private streamWidth: number = 1920;
  private streamHeight: number = 1080;
  private streamBitrateKbps: number = 5000;
  private streamMaxBitrateKbps: number = 7000;

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
   * Follow HTTP 302/307 redirects to get direct TorBox CDN endpoint
   */
  private async resolveFinalStreamUrl(rawUrl: string): Promise<string> {
    try {
      console.log(`[WorkerSession:${this.guildId}] Resolving stream URL redirect chain...`);
      const res = await fetch(rawUrl, {
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': 'DiscordStremioPlayer/1.0' },
        signal: AbortSignal.timeout(8000),
      });

      if (res.url && res.url.startsWith('http')) {
        console.log(`[WorkerSession:${this.guildId}] Resolved CDN endpoint: ${res.url.split('?')[0]}`);
        return res.url;
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
    quality?: string;
    voiceChannelId: string;
    textChannelId?: string;
    initialTime?: number;
  }): Promise<PlayerState> {
    this.voiceChannelId = options.voiceChannelId;
    this.textChannelId = options.textChannelId || null;
    this.currentTitle = options.title;
    this.currentStreamUrl = options.streamUrl;
    this.currentPosition = options.initialTime || 0;
    this.subtitleDelaySeconds = 0;
    this.playbackStatus = 'BUFFERING';

    this.configureQuality(options.quality || '1080p');
    console.log(`[WorkerSession:${this.guildId}] Opening media: "${this.currentTitle}" (Initial Quality: ${this.qualityLabel})`);

    const targetVc = options.voiceChannelId || this.voiceChannelId;
    if (targetVc) {
      const currentConnectedVc = (this.streamer as any).voiceConnection?.channelId;
      const isAlreadyInChannel = currentConnectedVc === targetVc;

      if (!isAlreadyInChannel) {
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
        console.log(`[WorkerSession:${this.guildId}] Already connected to voice channel ${targetVc}`);
      }
    }

    // 1. Run embedded subtitle discovery, external subtitle fetching in parallel
    const [rawExternalSubs, embeddedSubs, cdnUrl] = await Promise.all([
      options.imdbId
        ? fetchAvailableSubtitles(options.imdbId, options.type || 'movie').catch(() => [] as SubtitleTrackInfo[])
        : Promise.resolve([] as SubtitleTrackInfo[]),
      probeEmbeddedSubtitles(options.streamUrl).catch(() => [] as SubtitleTrackInfo[]),
      this.resolveFinalStreamUrl(options.streamUrl),
    ]);

    this.resolvedCdnUrl = cdnUrl;

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

    console.log(`[WorkerSession:${this.guildId}] Starting stream segment (${this.qualityLabel}, Seek: ${seekSeconds}s, Subtitles: "${this.activeSubtitle}", Delay: ${this.subtitleDelaySeconds}s)...`);

    const customInputOptions = seekSeconds > 0 ? ['-ss', String(seekSeconds)] : [];

    // Custom audio filtering: dialogue matrix + volume boost
    const customFfmpegFlags: string[] = [
      '-af',
      'volume=1.4,pan=stereo|c0=c2+0.6*c0+0.6*c4|c1=c2+0.6*c1+0.6*c5',
    ];

    if (this.activeSubtitle !== 'Off' && this.activeSubtitlePath && fs.existsSync(this.activeSubtitlePath)) {
      // Offset PTS by seekSeconds minus subtitleDelaySeconds for frame-accurate timing
      const effectiveTime = Math.max(0, seekSeconds - this.subtitleDelaySeconds);
      const vfFilter = (seekSeconds > 0 || this.subtitleDelaySeconds !== 0)
        ? `setpts=PTS+${effectiveTime}/TB,subtitles=${this.activeSubtitlePath}:force_style='FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=1.2,Shadow=0.5,MarginV=25',setpts=PTS-STARTPTS`
        : `subtitles=${this.activeSubtitlePath}:force_style='FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=1.2,Shadow=0.5,MarginV=25'`;

      customFfmpegFlags.push('-vf', vfFilter);
      console.log(`[WorkerSession:${this.guildId}] Subtitle filter active (${this.activeSubtitle} at effective seek ${effectiveTime}s): ${this.activeSubtitlePath}`);
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

    command.on('error', (err: any) => {
      if (this.playbackStatus === 'PLAYING') {
        console.warn(`[WorkerSession:${this.guildId}] FFmpeg notice:`, err.message);
      }
    });

    command.on('end', () => {
      console.log(`[WorkerSession:${this.guildId}] Segment completed.`);
      this.handleMediaFinished();
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
    } else if (q === '720p' || q === 'hd') {
      this.currentQuality = '720p';
      this.qualityLabel = '720p HD';
      this.streamWidth = 1280;
      this.streamHeight = 720;
      this.streamBitrateKbps = 2500;
      this.streamMaxBitrateKbps = 3500;
    } else if (q === '480p' || q === 'sd') {
      this.currentQuality = '480p';
      this.qualityLabel = '480p SD';
      this.streamWidth = 854;
      this.streamHeight = 480;
      this.streamBitrateKbps = 1200;
      this.streamMaxBitrateKbps = 1800;
    } else {
      // Default 1080p FHD
      this.currentQuality = '1080p';
      this.qualityLabel = '1080p FHD';
      this.streamWidth = 1920;
      this.streamHeight = 1080;
      this.streamBitrateKbps = 5000;
      this.streamMaxBitrateKbps = 7000;
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
    this.activeAudio = String(trackId);
    console.log(`[WorkerSession:${this.guildId}] Audio track set to: ${trackId}`);
    return true;
  }

  private async handleMediaFinished(): Promise<void> {
    try {
      const { queueManager } = await import('@discord-stremio/queue');
      const queueSize = await queueManager.size(this.guildId);

      if (queueSize > 0) {
        console.log(`[WorkerSession:${this.guildId}] Movie ended. Entering 2-minute Intermission mode (${queueSize} items in queue)...`);
        this.playbackStatus = 'INTERMISSION';
        this.intermissionRemaining = 120; // 2 minutes

        if (this.intermissionTimer) clearInterval(this.intermissionTimer);
        this.intermissionTimer = setInterval(async () => {
          this.intermissionRemaining -= 1;
          if (this.intermissionRemaining <= 0) {
            if (this.intermissionTimer) {
              clearInterval(this.intermissionTimer);
              this.intermissionTimer = null;
            }
            await this.playNextInQueue();
          }
        }, 1000);
      } else {
        this.playbackStatus = 'ENDED';
      }
    } catch (err) {
      console.warn(`[WorkerSession:${this.guildId}] Intermission notice:`, (err as Error).message);
      this.playbackStatus = 'ENDED';
    }
  }

  async playNextInQueue(): Promise<void> {
    if (this.intermissionTimer) {
      clearInterval(this.intermissionTimer);
      this.intermissionTimer = null;
    }
    this.intermissionRemaining = 0;

    try {
      const { queueManager } = await import('@discord-stremio/queue');
      const nextItem = await queueManager.dequeue(this.guildId);
      if (nextItem && this.voiceChannelId) {
        console.log(`[WorkerSession:${this.guildId}] Auto-playing next queued movie: "${nextItem.media.name}"...`);
        await this.openMedia({
          streamUrl: nextItem.stream.url,
          title: nextItem.media.name,
          imdbId: nextItem.media.imdbId,
          type: nextItem.media.type || 'movie',
          quality: nextItem.stream.quality || '1080p',
          voiceChannelId: this.voiceChannelId,
          textChannelId: this.textChannelId || undefined,
          initialTime: 0,
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
