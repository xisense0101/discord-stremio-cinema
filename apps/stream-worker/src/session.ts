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

/**
 * @dank074/discord-video-stream's Streamer.joinVoice() always sends
 * self_deaf: true on the initial VOICE_STATE_UPDATE (self_mute is already
 * false) - purely cosmetic for this headless worker (the Go-Live stream's
 * audio/video goes out over a separate stream connection, unaffected by the
 * regular voice self_deaf/self_mute flags; nothing here consumes incoming
 * voice audio either way), but shows a "deafened" icon next to the bot in
 * Discord's member list. Send one follow-up VOICE_STATE_UPDATE - the same
 * raw gateway call the library itself uses - to clear it.
 */
export function undeafenStreamer(streamer: Streamer, guildId: string, channelId: string): void {
  try {
    (streamer.client as any).ws.broadcast({
      op: 4, // Gateway opcode VOICE_STATE_UPDATE
      d: {
        guild_id: guildId,
        channel_id: channelId,
        self_mute: false,
        self_deaf: false,
        self_video: false,
      },
    });
  } catch (err) {
    console.warn(`[WorkerSession:${guildId}] undeafenStreamer notice:`, (err as Error).message);
  }
}

/**
 * Maps a requested quality (in any of the accepted user-facing forms, e.g.
 * "1080p", "fhd", "4k", "2160p", "2k"/"1440p" which has no distinct source
 * tag and falls back to the next best real source tier) to the source
 * `quality` tag used by the stream resolvers ('4k' | '1080p' | '720p' |
 * '480p' | 'other'). Mirrors the tier-1 entry of the resolver's own
 * `qualityPriority` table in aiostreams.ts/torbox.ts so "exact tier" here
 * means the same thing it means there.
 */
function normalizeQualityTier(quality: string): string {
  const q = (quality || '').toLowerCase().trim();
  if (q === '4k' || q === '2160p' || q === 'uhd' || q === '2k' || q === '1440p' || q === 'qhd') return '4k';
  if (q === '1080p' || q === 'fhd') return '1080p';
  if (q === '480p' || q === 'sd') return '480p';
  return '720p';
}

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
  private sourceRelease: string = '';
  private sourceQuality: string = '';
  private sourceSizeBytes: number = 0;
  private qualityMismatch: boolean = false;
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
    this.sourceRelease = '';
    this.sourceQuality = '';
    this.sourceSizeBytes = 0;
    this.qualityMismatch = false;

    this.configureQuality(options.quality || '720p');
    console.log(`[WorkerSession:${this.guildId}] Opening media: "${this.currentTitle}" (Quality: ${this.qualityLabel})`);

    // Ensure playback URL is always resolved from Worker IP to avoid ElfHosted IP-lock mismatches
    let streamUrlToUse = options.streamUrl;
    if (options.imdbId) {
      try {
        console.log(`[WorkerSession:${this.guildId}] Resolving verified working stream from Worker IP for ${options.type || 'movie'} ${options.imdbId}...`);
        const { resolveMediaStreams } = await import('@discord-stremio/metadata');
        const streams = await resolveMediaStreams(
          options.type || 'movie',
          options.imdbId,
          options.season,
          options.episode,
          options.quality || '720p'
        );
        if (streams && streams.length > 0) {
          // Probe candidate streams to find the first 100% playable direct
          // CDN stream that is not a slate. Candidates matching the
          // REQUESTED quality tier are probed first and exhausted before
          // falling back to any other tier - the resolver's own ranking
          // (rankStreams()) sorts by language score first, so a requested
          // 720p run can otherwise land on a working 4K/1080p candidate
          // that happens to rank ahead once the top 720p entries fail their
          // probe. The encoder always scales its OUTPUT to the requested
          // resolution regardless of source, but decoding a much larger
          // source than intended wastes bandwidth/CPU and can reintroduce
          // the exact lag this app has been tuned to avoid - so the quality
          // tier actually being decoded matters, not just the output size.
          const requestedQ = normalizeQualityTier(options.quality || '720p');
          const exactTier = streams.filter((s) => normalizeQualityTier(s.quality) === requestedQ);
          const otherTiers = streams.filter((s) => normalizeQualityTier(s.quality) !== requestedQ);
          const probeOrder = [...exactTier, ...otherTiers].slice(0, 12);

          let foundWorking = false;
          for (const cand of probeOrder) {
            try {
              const res = await fetch(cand.url, {
                method: 'HEAD',
                redirect: 'follow',
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                signal: AbortSignal.timeout(5000),
              });
              if (res.url && !res.url.includes('slate.elfhosted.com') && res.status < 400) {
                streamUrlToUse = res.url;
                this.sourceRelease = cand.title;
                this.sourceQuality = cand.quality;
                this.sourceSizeBytes = cand.sizeBytes || 0;
                this.qualityMismatch = normalizeQualityTier(cand.quality) !== requestedQ;
                if (this.qualityMismatch) {
                  console.warn(`[WorkerSession:${this.guildId}] No reachable ${requestedQ} candidate - falling back to "${cand.title}" (${cand.quality}). Output is still encoded at ${requestedQ}, but the source being decoded is ${cand.quality}.`);
                }
                console.log(`[WorkerSession:${this.guildId}] Confirmed playable CDN stream: "${cand.title}" (${cand.quality}) -> ${res.url.split('?')[0]}`);
                foundWorking = true;
                break;
              } else {
                console.warn(`[WorkerSession:${this.guildId}] Candidate "${cand.title}" returned slate video or error (${res.status}). Checking next...`);
              }
            } catch {
              // try next candidate
            }
          }
          if (!foundWorking && streams[0]?.url) {
            streamUrlToUse = streams[0].url;
            this.sourceRelease = streams[0].title;
            this.sourceQuality = streams[0].quality;
            this.sourceSizeBytes = streams[0].sizeBytes || 0;
            this.qualityMismatch = normalizeQualityTier(streams[0].quality) !== requestedQ;
          }
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
          undeafenStreamer(this.streamer, this.guildId, this.voiceChannelId);
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

    // Load multi-language Audio Tracks & auto-select the intended default
    if (probedAudioTracks && probedAudioTracks.length > 0) {
      this.audioTracks = probedAudioTracks.map((a: AudioTrackInfo) => ({
        id: String(a.audioStreamIndex),
        label: a.label,
        language: a.language,
        enabled: false,
      }));

      const isCommentary = (label: string) => {
        const l = label.toLowerCase();
        return l.includes('commentary') || l.includes('description') || l.includes('director');
      };
      const isEnglish = (t: AudioTrackInfo) =>
        t.language.toLowerCase() === 'english' || t.rawLanguage === 'eng' || t.rawLanguage === 'en';

      const eligible = probedAudioTracks
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => !isCommentary(t.label));
      const pool = eligible.length > 0 ? eligible : probedAudioTracks.map((t, i) => ({ t, i }));

      // Priority: 1) English by language tag, 2) container-flagged default
      // track (ffprobe disposition), 3) first eligible (non-commentary)
      // track as a last resort.
      //
      // English outranks the container's own default flag on purpose: real
      // multi-dub releases (verified against a live "How to Train Your
      // Dragon" torrent) routinely ship with disposition:default=1 set on a
      // regional dub - e.g. a Tamil-focused uploader's mux flags the Tamil
      // track as "default" even though an English track exists in the same
      // file - so trusting that flag over an explicit English match
      // reproduces exactly the wrong-dub bug this is meant to fix.
      const englishTrack = pool.find(({ t }) => isEnglish(t));
      const defaultFlagged = pool.find(({ t }) => t.isDefault);
      const chosen = englishTrack || defaultFlagged || pool[0];
      const defaultTrackIndex = chosen.i;

      this.activeAudioStreamIndex = defaultTrackIndex;
      this.audioTracks[this.activeAudioStreamIndex].enabled = true;
      this.activeAudio = this.audioTracks[this.activeAudioStreamIndex]?.label || 'Default Audio';
      console.log(`[WorkerSession:${this.guildId}] Discovered ${this.audioTracks.length} audio tracks. Active: "${this.activeAudio}" [0:a:${this.activeAudioStreamIndex}] (reason: ${englishTrack ? 'English match' : defaultFlagged ? 'container default flag' : 'first eligible track'})`);
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

  private segmentGeneration: number = 0;

  private async startStreamSegment(seekSeconds: number = 0): Promise<void> {
    // Claim this attempt's generation. If a newer call to startStreamSegment
    // supersedes us before we finish (e.g. the user double-clicks a quality
    // change), we bail out instead of racing to become the active stream.
    const generation = ++this.segmentGeneration;

    const RECONNECT_SETTLE_MS = 600;

    // Kill the previous segment's ffmpeg and confirm it has fully exited
    // BEFORE starting the new one. This is a deliberate ordering choice.
    //
    // An earlier version primed (built + connected) the new ffmpeg process
    // BEFORE touching the old one, specifically to shrink the visible gap on
    // viewers' screens. That is wrong for this app's debrid CDN sources:
    // real production logs showed the old and new ffmpeg processes both
    // connected to the IDENTICAL debrid URL (TorBox tb-cdn.pw link)
    // simultaneously for ~5 seconds during a subtitle/seek change. The new
    // connection's demuxer found the stream headers fine, then hit
    // "Reached end of stream" within ~1s of actually being swapped in -
    // consistent with the CDN enforcing one connection per link and
    // truncating/rejecting the second, concurrent connection to the same
    // URL. Because more than 30s of playback position had already elapsed,
    // that premature EOF was treated as "movie finished" (see the 'end'
    // handler below), ending playback outright instead of resuming - this
    // is what made subtitle/quality/seek changes appear to permanently kill
    // the stream. Never open a second connection to the same source URL
    // while the first is still open.
    if (this.activeFfmpegCommand) {
      const dying = this.activeFfmpegCommand;
      this.activeFfmpegCommand = null;
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        dying.once('error', done);
        dying.once('end', done);
        setTimeout(done, 400);
        try {
          dying.kill('SIGKILL');
        } catch {
          done();
        }
      });

      try {
        this.streamer.stopStream();
      } catch {}

      // Give Discord's gateway a moment to process the STREAM_DELETE before
      // the next segment's playStream() sends STREAM_CREATE - calling them
      // back-to-back risks the new handshake hanging forever (verified live).
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_SETTLE_MS));

      if (generation !== this.segmentGeneration) {
        console.warn(`[WorkerSession:${this.guildId}] Superseded while the previous segment was closing.`);
        return;
      }
    }

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
      `[WorkerSession:${this.guildId}] Preparing stream segment (${this.qualityLabel}, Audio: "${this.activeAudio}" [0:a:${this.activeAudioStreamIndex}], Seek: ${seekSeconds}s, Subtitles: "${this.activeSubtitle}")...`
    );

    const threads = String(config.stream.encodeThreads);

    const customInputOptions: string[] = [
      ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
      '-reconnect', '1',
      '-reconnect_at_eof', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-probesize', '10M',
      '-analyzeduration', '10M',
      '-threads', threads,
    ];

    // Single unified filtergraph for video (scaling + subtitle rendering).
    // IMPORTANT: `-vf` and `-filter:v` are the SAME ffmpeg option - the
    // library's prepareStream() already emits its own `-filter:v
    // scale=WxH` internally. If we also emit a separate `-vf` flag here (as
    // this code used to do, containing ONLY the subtitle filter), ffmpeg
    // takes the LAST occurrence on the command line and silently discards
    // the other - so the moment subtitles were on, the scale filter was
    // dropped entirely and the stream got encoded at the SOURCE file's
    // native resolution (verified live: a 720p-configured session was
    // actually streaming at the source's native ~536p because of this,
    // confirmed by dumping the running ffmpeg command line on the VPS).
    // Fix: always own the full video filter chain ourselves whenever we
    // need to emit `-vf` at all, starting with the same scale the library
    // would have applied, so it can never be silently clobbered. Scaling
    // BEFORE burning in subtitles also keeps subtitle font size consistent
    // regardless of the source file's native resolution.
    const vfFilters: string[] = [`scale=${this.streamWidth}:${this.streamHeight}`];

    if (this.activeSubtitle !== 'Off' && this.activeSubtitlePath && fs.existsSync(this.activeSubtitlePath)) {
      // Offset PTS by seekSeconds minus subtitleDelaySeconds for frame-accurate timing
      const effectiveTime = Math.max(0, seekSeconds - this.subtitleDelaySeconds);
      const subFilter = (seekSeconds > 0 || this.subtitleDelaySeconds !== 0)
        ? `setpts=PTS+${effectiveTime}/TB,subtitles=${this.activeSubtitlePath}:force_style='FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=1.2,Shadow=0.5,MarginV=25',setpts=PTS-STARTPTS`
        : `subtitles=${this.activeSubtitlePath}:force_style='FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BorderStyle=1,Outline=1.2,Shadow=0.5,MarginV=25'`;

      vfFilters.push(subFilter);
      console.log(`[WorkerSession:${this.guildId}] Unified subtitle filter active (${this.activeSubtitle} at effective seek ${effectiveTime}s): ${this.activeSubtitlePath}`);
    }

    // Widen the VBV buffer beyond the nominal bitrate (was == bitrate, i.e. a
    // ~1s buffer) so brief CPU contention on the shared VPS doesn't force the
    // encoder to visibly stall/drop under strict CBR. Adds a small amount of
    // acceptable latency in exchange for a much smoother stream.
    const vbvBufsizeKbps = Math.round(this.streamMaxBitrateKbps * 1.5);

    // Custom audio mapping + filtering: dialogue matrix + volume boost
    const customFfmpegFlags: string[] = [
      '-threads', threads,
      '-filter_threads', threads,
      '-b:v', `${this.streamBitrateKbps}k`,
      '-maxrate:v', `${this.streamMaxBitrateKbps}k`,
      '-bufsize:v', `${vbvBufsizeKbps}k`,
      // `-map` is CUMULATIVE, not last-wins. prepareStream() already emits
      // its own `-map 0:v` and `-map 0:a:0?` before these flags, so simply
      // adding our own maps on top produced FOUR mapped streams
      // (video, audio, video, audio) - ffmpeg spun up two libx264 instances
      // and two libopus instances and encoded everything TWICE, while the
      // downstream demuxer read only the first video/audio pair and threw
      // the duplicates away. Verified on the live VPS: that doubled encode
      // was the bulk of the worker's CPU draw and pushed it into CFS
      // throttling (65 throttle events in ~5 min), which is what the stream
      // stutter actually was.
      //
      // Negative maps cancel the library's before we add our own, so the
      // output carries exactly one video and one audio stream. Cancelling
      // `0:v` (all video) rather than relying on `0:v:0` also drops embedded
      // cover art, which many releases carry as a second video stream and
      // which would otherwise be encoded as well.
      '-map', '-0:v',
      '-map', '0:v:0',
      '-map', '-0:a:0',
      '-map', `0:a:${this.activeAudioStreamIndex}?`,
      '-af', 'volume=1.4,pan=stereo|c0=c2+0.6*c0+0.6*c4|c1=c2+0.6*c1+0.6*c5',
    ];

    if (vfFilters.length > 0) {
      customFfmpegFlags.push('-vf', vfFilters.join(','));
    }

    // Only NOW - after the previous segment's connection to this same
    // source URL has been fully closed above - open the new one.
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

    try {
      // Synchronize: wait until output has header bytes ready before demuxing
      await new Promise<void>((resolve, reject) => {
        command.once('error', reject);
        if (output.readableLength > 0) return resolve();
        output.once('readable', () => resolve());
      });
    } catch (err) {
      console.warn(`[WorkerSession:${this.guildId}] New segment failed to start:`, (err as Error).message);
      try { command.kill('SIGKILL'); } catch {}
      this.playbackStatus = 'ERROR';
      return;
    }

    // A newer request already superseded this one while we were connecting;
    // discard this stale process instead of swapping it in.
    if (generation !== this.segmentGeneration) {
      console.warn(`[WorkerSession:${this.guildId}] Superseded by a newer segment request, discarding new ffmpeg process.`);
      try { command.kill('SIGKILL'); } catch {}
      return;
    }

    this.activeFfmpegCommand = command;
    this.playbackStatus = 'PLAYING';
    this.isStreaming = true;

    console.log(`[WorkerSession:${this.guildId}] Swapping in new stream segment.`);

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

    // Mid-session quality changes re-encode the SAME already-resolved source
    // file at the new output resolution (re-resolving a different source
    // here would mean a second candidate probe + CDN reconnect mid-playback,
    // which risks the single-connection-per-link dead-air bug this app was
    // already burned by once). So recompute the mismatch flag against the
    // actual source tier: e.g. switching to 1080p on a source that was only
    // ever resolved at 720p means Discord will show an UPSCALED 720p source,
    // not a genuine 1080p decode - the UI should say so.
    if (this.sourceQuality) {
      this.qualityMismatch = normalizeQualityTier(this.sourceQuality) !== normalizeQualityTier(quality);
      if (this.qualityMismatch) {
        console.warn(`[WorkerSession:${this.guildId}] Quality mismatch: output set to ${this.qualityLabel} but source file is "${this.sourceRelease}" (${this.sourceQuality}). Re-open the title to re-resolve a matching source instead of scaling.`);
      }
    }

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
      sourceRelease: this.sourceRelease || undefined,
      sourceQuality: this.sourceQuality || undefined,
      sourceSizeBytes: this.sourceSizeBytes || undefined,
      qualityMismatch: this.qualityMismatch,
    };
  }

  async stop(): Promise<void> {
    this.isStreaming = false;
    this.isVoiceConnected = false;
    this.playbackStatus = 'IDLE';

    // Invalidate any in-flight startStreamSegment() that is still priming a
    // new ffmpeg process, so it discards itself instead of swapping in after
    // we've already stopped.
    this.segmentGeneration++;

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
