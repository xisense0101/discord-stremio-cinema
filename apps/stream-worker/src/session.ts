import fs from 'fs';
import { Streamer, prepareStream, playStream, Utils, Encoders } from '@dank074/discord-video-stream';
import { PlayerState, SubtitleTrack, AudioTrack } from '@discord-stremio/playback';
import {
  fetchAvailableSubtitles,
  downloadSubtitleFile,
  probeEmbeddedSubtitles,
  extractEmbeddedSubtitle,
  pickBestSubtitle,
  rescaleSrtForFps,
  probeEmbeddedAudioTracks,
  probeSourceMedia,
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
  /** Frame rate actually sent to Discord - matched to the source, capped at config.stream.fps. */
  private outputFps: number = config.stream.fps;
  private sourceRelease: string = '';
  private sourceQuality: string = '';
  private sourceSizeBytes: number = 0;
  private qualityMismatch: boolean = false;
  /**
   * Real runtime of the current file in seconds, read from the source during
   * openMedia()'s probe. 0 means "not known yet" - the UI must not invent a
   * length, which is what the old hardcoded 7200 default did: every movie
   * showed a 2:00:00 total and a progress bar scaled to it, so a 95-minute
   * film ended at ~79% and a 3-hour one sat pinned at 100% for an hour.
   */
  private duration: number = 0;
  /** Re-entrancy guard: several signals can conclude the same movie is over. */
  private finishingMedia: boolean = false;
  /** Surfaced to the UI so a failure says why, instead of just going blank. */
  private errorMessage: string = '';
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
   * Checks whether a candidate link will actually serve video, and returns the
   * final CDN URL it resolves to.
   *
   * This deliberately issues a ranged GET rather than a HEAD. ElfHosted's
   * playback proxy answers HEAD for a perfectly good link by redirecting to
   * slate.elfhosted.com (its placeholder clip), and answers some with a bare
   * 405 Method Not Allowed - so a HEAD probe reported healthy sources as dead.
   * Verified against one link on the worker itself:
   *
   *   HEAD              -> slate.elfhosted.com, 200
   *   GET Range 0-1023  -> nexus-158.indi.tb-cdn.pw, 206, real bytes
   *
   * That false negative is what rejected every candidate for several titles
   * and, before this, what made the player "buffer" forever or play a two
   * minute slate. A GET for the first byte is what ffmpeg is about to do
   * anyway, so it answers the only question that matters: will this play?
   * The body is cancelled immediately so nothing is actually downloaded.
   */
  private async probeCandidate(cand: { url: string; title: string }): Promise<{
    ok: boolean;
    url: string;
    reason: string;
  }> {
    // Only the response headers are needed - the status and the URL the chain
    // ended at. Aborting explicitly the moment they arrive is what keeps this
    // cheap: slate.elfhosted.com ignores the Range header and starts sending
    // the whole placeholder clip, and waiting on body.cancel() to unwind that
    // cost about 16s per candidate (measured: 145s to walk one dead tier).
    // Aborting the controller drops the connection immediately instead.
    // 20s, not the few seconds that feel natural for a "quick check".
    // ElfHosted's response time for these links varies from ~3s to well over
    // 8s regardless of whether the link is good, so a tight timeout simply
    // reintroduces the false negatives this probe exists to eliminate:
    // measured at 8s, six of eight candidates aborted, including 1080p links
    // independently confirmed to serve real video. Wrongly declaring a
    // watchable film unplayable is far worse than a slow start, and the cost
    // is only ever paid when candidates are actually failing - a healthy
    // title answers on the first probe.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(cand.url, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Range: 'bytes=0-1023',
        },
        signal: controller.signal,
      });

      const finalUrl = res.url;
      const status = res.status;
      controller.abort();

      if (finalUrl && finalUrl.includes('slate.elfhosted.com')) {
        return { ok: false, url: '', reason: 'resolved to an ElfHosted slate placeholder' };
      }
      if (status >= 400) {
        return { ok: false, url: '', reason: `HTTP ${status}` };
      }
      return { ok: true, url: finalUrl || cand.url, reason: '' };
    } catch (err) {
      return { ok: false, url: '', reason: (err as Error).message };
    } finally {
      clearTimeout(timer);
    }
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

      // 2. Standard HTTP redirect resolution with browser user-agent.
      // Uses a ranged GET for the same reason probeCandidate() does: a HEAD
      // here gets redirected to the slate placeholder even for links that
      // play perfectly, and this function's result is the URL handed straight
      // to ffmpeg - so a HEAD was how the two minute slate ended up being
      // streamed as if it were the movie.
      if (rawUrl.startsWith('http')) {
        console.log(`[WorkerSession:${this.guildId}] Resolving stream URL redirect chain...`);
        // Aborted at the headers for the same reason probeCandidate() does -
        // a slate response ignores Range and would otherwise stream in full.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let res: Response;
        try {
          res = await fetch(rawUrl, {
            method: 'GET',
            redirect: 'follow',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Range: 'bytes=0-1023',
            },
            signal: controller.signal,
          });
          controller.abort();
        } finally {
          clearTimeout(timer);
        }

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
    this.duration = 0;
    this.finishingMedia = false;
    this.errorMessage = '';

    this.configureQuality(options.quality || '720p');
    console.log(`[WorkerSession:${this.guildId}] Opening media: "${this.currentTitle}" (Quality: ${this.qualityLabel})`);

    // Ensure playback URL is always resolved from Worker IP to avoid ElfHosted IP-lock mismatches
    let streamUrlToUse = options.streamUrl;
    // "Nothing playable exists" has to escape the catch below, which is there
    // to tolerate a flaky resolver call and fall through to whatever URL the
    // caller supplied - not to swallow a definitive verdict that every source
    // for this title is dead.
    let unplayable: Error | null = null;
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

          // Each tier gets its own budget, instead of taking the first N of
          // the concatenation. A popular title returns well over a hundred
          // candidates, so `[...exactTier, ...otherTiers].slice(0, 12)` was
          // filled entirely by the requested tier and the fallback tiers were
          // never reached at all. That is exactly how playback failed for a
          // title whose sources were fine: every 720p candidate for The Eye
          // resolves to a slate, while its 1080p candidates return 206 from
          // the real CDN - but the 1080p ones were always sliced off the end
          // of the list. The requested tier is still tried first and in full,
          // so quality preference is unchanged; this only guarantees there is
          // somewhere to fall back to before declaring a title unplayable.
          //
          // The budgets are deliberately small. Probes cannot be run in
          // parallel - ElfHosted throttles concurrent requests, and even
          // three at once made two of three healthy links time out - and a
          // dead candidate costs 6-8s because ElfHosted is slow to give up
          // before redirecting to its slate. Availability is also strongly
          // correlated within a tier: for a title where 720p was unavailable,
          // all twelve 720p candidates were slates while its 1080p ones
          // played. So a few from the requested tier is a sufficient sample,
          // and spending the rest of the budget on other tiers reaches a
          // playable source far sooner than exhausting a tier that is clearly
          // gone. A healthy title pays none of this: probing stops at the
          // first candidate that answers, normally the first one tried.
          const probeOrder = [...exactTier.slice(0, 3), ...otherTiers.slice(0, 5)];

          // Probed one at a time, stopping at the first that answers.
          //
          // This is deliberately NOT parallel. Probing all 12 at once was
          // tried and made things strictly worse: ElfHosted throttles
          // concurrent requests, so of 12 simultaneous probes 7 came back as
          // slate placeholders and 5 timed out - for a title whose sources
          // are perfectly healthy. Probed sequentially, the very same links
          // return 206 from the real TorBox CDN. Sequential probing is also
          // no longer slow, because it was never the loop that was slow: the
          // old HEAD probe rejected everything, so all 12 always ran. With a
          // truthful probe the first candidate usually wins outright, so a
          // normal open costs one probe rather than twelve.
          const probed: Array<{ ok: boolean; url: string; reason: string }> = [];
          let winnerIndex = -1;
          for (const cand of probeOrder) {
            const result = await this.probeCandidate(cand);
            probed.push(result);
            if (result.ok) {
              winnerIndex = probed.length - 1;
              break;
            }
          }

          if (winnerIndex >= 0) {
            const cand = probeOrder[winnerIndex];
            streamUrlToUse = probed[winnerIndex].url;
            this.sourceRelease = cand.title;
            this.sourceQuality = cand.quality;
            this.sourceSizeBytes = cand.sizeBytes || 0;
            this.qualityMismatch = normalizeQualityTier(cand.quality) !== requestedQ;
            if (this.qualityMismatch) {
              console.warn(`[WorkerSession:${this.guildId}] No reachable ${requestedQ} candidate - falling back to "${cand.title}" (${cand.quality}). Output is still encoded at ${requestedQ}, but the source being decoded is ${cand.quality}.`);
            }
            console.log(`[WorkerSession:${this.guildId}] Confirmed playable CDN stream: "${cand.title}" (${cand.quality}) -> ${streamUrlToUse.split('?')[0]}`);
          } else {
            for (let i = 0; i < probed.length; i++) {
              console.warn(`[WorkerSession:${this.guildId}] Candidate "${probeOrder[i].title}" rejected: ${probed[i].reason}`);
            }
          }

          if (winnerIndex < 0) {
            // Every candidate was a slate or an error. Falling back to
            // streams[0] here (as this used to) hands playback a link already
            // proven bad: ElfHosted answers an IP-locked link with a ~2 minute
            // placeholder clip, so the session dutifully "played" a 2 minute
            // slate, reported it as the movie - runtime and all - and then
            // ended. Reported as the stream buffering and never starting.
            // Fail loudly instead so the caller can move on to something that
            // will actually play.
            unplayable = new Error(
              `No playable source for "${options.title}" - all ${probed.length} candidates returned an ElfHosted slate or an error (sources unavailable or throttled right now).`
            );
          }
        }
      } catch (err) {
        console.warn(`[WorkerSession:${this.guildId}] Worker IP stream resolution notice:`, (err as Error).message);
      }
    }

    if (unplayable) {
      console.error(`[WorkerSession:${this.guildId}] ${unplayable.message}`);
      this.playbackStatus = 'ERROR';
      this.errorMessage = unplayable.message;
      throw unplayable;
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
    const [rawExternalSubs, embeddedSubs, probedMedia] = await Promise.all([
      options.imdbId
        ? fetchAvailableSubtitles(options.imdbId, options.type || 'movie').catch(() => [] as SubtitleTrackInfo[])
        : Promise.resolve([] as SubtitleTrackInfo[]),
      probeEmbeddedSubtitles(probeTargetUrl).catch(() => [] as SubtitleTrackInfo[]),
      probeSourceMedia(probeTargetUrl, 5000).catch(() => ({ audioTracks: [] as AudioTrackInfo[], video: null })),
    ]);
    const probedAudioTracks = probedMedia.audioTracks;

    // Match the output frame rate to the source instead of always forcing 30.
    // Nearly every film release is 23.976fps, and resampling that to 30
    // duplicates roughly one frame in five on an uneven cadence - visible as
    // judder that reads as "stuttering" no matter how much CPU headroom the
    // encoder has, while also making the encoder and the Discord packetizer
    // do ~25% more work per second of video for nothing. Capped at the
    // configured fps so a high-frame-rate source can't inflate the workload.
    this.duration = probedMedia.video?.durationSeconds || 0;
    if (this.duration > 0) {
      const h = Math.floor(this.duration / 3600);
      const m = Math.round((this.duration % 3600) / 60);
      console.log(`[WorkerSession:${this.guildId}] Source runtime: ${h}h ${m}m (${this.duration}s)`);
    } else {
      console.warn(`[WorkerSession:${this.guildId}] Could not read a runtime from the source; the UI will show elapsed time only.`);
    }

    const sourceFps = probedMedia.video?.fps;
    if (sourceFps && sourceFps >= 10) {
      this.outputFps = Math.min(sourceFps, config.stream.fps);
      console.log(`[WorkerSession:${this.guildId}] Source video: ${probedMedia.video?.width}x${probedMedia.video?.height} ${probedMedia.video?.codec} @ ${sourceFps}fps -> streaming at ${this.outputFps}fps`);
    } else {
      this.outputFps = config.stream.fps;
    }

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

      // Auto-select English subtitles by default. Among the English
      // candidates, pick the one whose frame rate and release actually match
      // the file being played rather than whichever the API listed first -
      // that arbitrary choice is what left most films out of sync.
      const isEnglish = (s: SubtitleTrackInfo) => {
        const l = s.lang.toLowerCase();
        return l === 'english' || l === 'en' || l.startsWith('en-') || l.includes('english');
      };
      const englishCandidates = rawExternalSubs.filter(isEnglish);
      const enSub =
        pickBestSubtitle(englishCandidates, {
          sourceFps: this.outputFps,
          sourceRelease: this.sourceRelease,
        }) || allSubs.find((s) => s.lang.toLowerCase().includes('english'));

      if (enSub) {
        const targetPath = `/tmp/sub_${this.guildId}.srt`;
        console.log(`[WorkerSession:${this.guildId}] Auto-selecting English subtitle (${englishCandidates.length} candidates; chose ${enSub.fps ? enSub.fps + 'fps' : 'unknown fps'}${enSub.releaseName ? ` "${enSub.releaseName}"` : ''}) for a ${this.outputFps}fps source...`);
        let downloaded = false;
        if (enSub.url) {
          downloaded = await downloadSubtitleFile(enSub.url, targetPath);
        } else if (enSub.isEmbedded && enSub.streamIndex !== undefined) {
          downloaded = await extractEmbeddedSubtitle(this.resolvedCdnUrl || this.currentStreamUrl, enSub.streamIndex, targetPath);
        }

        // Residual frame-rate mismatch is corrected by rescaling the file:
        // this error grows with runtime, so no fixed delay can fix it.
        if (downloaded && enSub.fps && this.outputFps) {
          if (rescaleSrtForFps(targetPath, enSub.fps, this.outputFps)) {
            console.log(`[WorkerSession:${this.guildId}] Rescaled subtitles from ${enSub.fps}fps to ${this.outputFps}fps (drift would have been ~${Math.round(Math.abs(enSub.fps / this.outputFps - 1) * 7200)}s across a 2h film).`);
          }
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

    // 'veryfast' rather than 'ultrafast', deliberately spending ffmpeg's spare
    // CPU to take load off Node's.
    //
    // Profiling a live stream showed the bottleneck is not the encoder: ffmpeg
    // sits around 30% of a core while the single Node thread that packetizes
    // and sends RTP runs at 96-97%, and almost none of that is real work -
    // node_datachannel (the actual SRTP/send path) accounts for 0.03% of
    // samples, with the rest going to V8's per-packet async bookkeeping. At
    // 97% there is no headroom, so any hiccup delays packets, which is what
    // shows up as the picture slowing down and the audio pulling ahead of the
    // burned-in subtitles.
    //
    // Node's cost scales with packet count, so the lever is bits on the wire.
    // ultrafast is a poor use of them; veryfast compresses meaningfully better
    // for CPU the encoder has to spare, which buys back the bitrate reduction
    // below at similar visual quality.
    const encoder = Encoders.software({
      x264: {
        preset: 'veryfast',
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
    // `scale=W:H` on its own forces the frame into the target box and ignores
    // the source's shape, so anything not already 16:9 came out distorted:
    // a 1280x532 scope release (verified live - Spider-Man: No Way Home)
    // was being stretched vertically by about 35%, making everyone on screen
    // tall and thin. force_original_aspect_ratio=decrease fits the frame
    // inside the box keeping its proportions, and pad centres it with black
    // bars. The -2 rounding keeps both dimensions even, which H.264's 4:2:0
    // chroma subsampling requires.
    const vfFilters: string[] = [
      `scale=${this.streamWidth}:${this.streamHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2`,
      `pad=${this.streamWidth}:${this.streamHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
    ];

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
      // prepareStream() forces a keyframe every single second
      // (`-force_key_frames expr:gte(t,n_forced*1)`). At these bitrates a 720p
      // keyframe is an order of magnitude larger than a P-frame, so at 1s
      // spacing keyframes eat a large share of the CBR budget - starving the
      // P-frames in between and making the rate controller visibly pulse once
      // a second - and each one arrives as a burst the packetizer has to push
      // out at once. Stretching to 2s halves that overhead and hands the bits
      // back to the frames actually being watched. Discord viewers still get a
      // keyframe quickly enough to join and to recover from loss.
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
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

    // Bound the segment to the movie's remaining runtime so ffmpeg exits by
    // itself when the film is over.
    //
    // Without this, ffmpeg never terminates at the end of a file. Both this
    // code and prepareStream() pass `-reconnect_at_eof 1` (and the library's
    // copy is emitted after ours, so it wins on duplicate-option precedence
    // and cannot be overridden from customInputOptions). That flag is meant
    // for live or still-growing sources: on a fixed-length movie it tells
    // ffmpeg to reconnect and keep waiting at EOF instead of exiting. So the
    // process sat there forever, the 'end' event below never fired,
    // handleMediaFinished() was never reached, and playback went blank while
    // the session still reported PLAYING - no intermission, no next title.
    // Verified live: three ffmpeg processes were found still running on a
    // movie that had finished minutes earlier.
    //
    // `-t` is an output option, and ours are appended last, so this one does
    // take effect. It is a bound, not a trim: it equals exactly what is left
    // of the film from this seek point.
    if (this.duration > 0) {
      const remaining = this.duration - seekSeconds;
      if (remaining > 1) {
        customFfmpegFlags.push('-t', String(Math.ceil(remaining)));
      }
    }

    // Only NOW - after the previous segment's connection to this same
    // source URL has been fully closed above - open the new one.
    const { command, output } = prepareStream(this.resolvedCdnUrl, {
      encoder,
      width: this.streamWidth,
      height: this.streamHeight,
      frameRate: this.outputFps,
      bitrateVideo: this.streamBitrateKbps,
      bitrateVideoMax: this.streamMaxBitrateKbps,
      bitrateAudio: config.stream.audioBitrateKbps,
      videoCodec: Utils.normalizeVideoCodec('H264'),
      includeAudio: true,
      customInputOptions,
      customFfmpegFlags,
    });

    try {
      // Synchronize: wait until output has header bytes ready before demuxing.
      //
      // The timeout is essential, not defensive. A segment that produces no
      // output at all - most easily by seeking to or past the final second of
      // the file, but equally by a source that stops responding - would
      // otherwise never emit 'readable' and never emit 'error', so this await
      // hung forever: the function never reached the kill/supersede handling
      // below, so the ffmpeg process was never cleaned up and the session was
      // left wedged. Verified live, with two orphaned `-ss <duration>`
      // processes still holding connections to the source long afterwards -
      // which matters especially here, because these debrid links only
      // tolerate one connection at a time, so leaked processes can break the
      // stream that is still playing.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('no output produced within 20s')),
          20000
        );
        const settle = (err?: Error) => {
          clearTimeout(timer);
          err ? reject(err) : resolve();
        };
        command.once('error', (err: Error) => settle(err));
        if (output.readableLength > 0) return settle();
        output.once('readable', () => settle());
      });
    } catch (err) {
      console.warn(`[WorkerSession:${this.guildId}] New segment failed to start:`, (err as Error).message);
      try { command.kill('SIGKILL'); } catch {}
      // Only claim the session broke if this attempt is still the current one;
      // a superseded attempt failing is expected and must not clobber the
      // status of the segment that replaced it.
      if (generation === this.segmentGeneration) {
        // Running past the end of the film is a finished movie, not an error -
        // hand it to the same path a clean ffmpeg exit would take so the
        // intermission and the next queue item still happen.
        if (this.duration > 0 && seekSeconds >= this.duration - 2) {
          void this.handleMediaFinished();
        } else {
          this.playbackStatus = 'ERROR';
        }
      }
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
      if (this.playbackStatus !== 'PLAYING') return;
      this.currentPosition += 1;

      // Backstop for finishing a movie. The `-t` bound above should make
      // ffmpeg exit on its own and fire 'end', but the clock reaching the
      // runtime is independent evidence that the film is over, and it is what
      // keeps a wedged or silently-stalled encoder from leaving the session
      // stuck on PLAYING forever with a blank screen - the exact failure this
      // replaced. A couple of seconds of slack absorbs clock drift.
      if (
        this.duration > 0 &&
        this.activeFfmpegCommand === command &&
        this.currentPosition >= this.duration + 2
      ) {
        console.log(`[WorkerSession:${this.guildId}] Playback clock reached the end of the movie (${this.duration}s) without ffmpeg exiting - finishing.`);
        if (this.progressInterval) {
          clearInterval(this.progressInterval);
          this.progressInterval = null;
        }
        try { command.kill('SIGKILL'); } catch {}
        this.activeFfmpegCommand = null;
        void this.handleMediaFinished();
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
    let target = Math.max(0, seconds);

    // Dragging the scrubber to the very end asks ffmpeg to start at EOF, which
    // produces no frames at all. Treat landing in the last few seconds as
    // "finish the movie" - that is what the user meant - and otherwise keep
    // the start point just inside the file.
    if (this.duration > 0 && target >= this.duration - 3) {
      console.log(`[WorkerSession:${this.guildId}] Seek to ${target}s is at/after the end of a ${this.duration}s movie - finishing it.`);
      this.currentPosition = this.duration;
      await this.handleMediaFinished();
      return;
    }

    console.log(`[WorkerSession:${this.guildId}] Seeking to ${target}s...`);
    this.currentPosition = target;
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
      // Default 720p HD.
      // 2000 rather than 2500: Node's packetizing thread is the bottleneck at
      // ~97% of a core, and its cost scales with packet count, so 20% fewer
      // bits on the wire is 20% less load on the part that is actually
      // saturated. The veryfast preset above compresses better than the
      // ultrafast one this replaced, so the picture should hold up despite
      // the lower ceiling.
      this.currentQuality = '720p';
      this.qualityLabel = '720p HD';
      this.streamWidth = 1280;
      this.streamHeight = 720;
      this.streamBitrateKbps = 2000;
      this.streamMaxBitrateKbps = 2200;
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
    // Several independent signals can now conclude a movie is over (ffmpeg
    // exiting, the playback clock passing the runtime, a seek landing at the
    // end, a segment producing no output past the end). They can race, and
    // handling the same ending twice would dequeue two titles and skip one.
    if (this.finishingMedia) return;
    this.finishingMedia = true;

    try {
      const { queueSize: getQueueSize } = await import('./queue-store.js');
      const { getStoredSettings } = await import('./settings-store.js');
      const queueSize = getQueueSize(this.guildId);

      if (queueSize > 0) {
        const intermissionSeconds = Math.max(0, getStoredSettings().intermissionSeconds ?? 120);
        console.log(`[WorkerSession:${this.guildId}] Media finished. Starting ${intermissionSeconds}s intermission before the next queue item (${queueSize} remaining)...`);
        this.playbackStatus = 'INTERMISSION';
        this.intermissionRemaining = intermissionSeconds;

        if (intermissionSeconds === 0) {
          await this.playNextInQueue();
          return;
        }

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
    if (this.intermissionTimer) {
      clearInterval(this.intermissionTimer);
      this.intermissionTimer = null;
    }
    this.intermissionRemaining = 0;

    try {
      const { dequeue } = await import('./queue-store.js');

      // Keep taking items until one actually starts. A single unplayable
      // entry (source pulled, nothing resolvable) used to end the whole
      // queue; the rest of the night should not be lost to one bad title.
      for (let attempt = 0; attempt < 5; attempt++) {
        const nextItem = dequeue(this.guildId);
        if (!nextItem) break;

        // A stored stream URL is optional: debrid links are IP-locked and
        // expire, so openMedia() re-resolves from the imdbId regardless. Only
        // an entry with neither is unplayable.
        if (!nextItem.media?.imdbId && !nextItem.stream?.url) {
          console.warn(`[WorkerSession:${this.guildId}] Skipping unplayable queue entry "${nextItem.media?.name || nextItem.id}" (no imdbId and no stream URL).`);
          continue;
        }

        console.log(`[WorkerSession:${this.guildId}] Auto-playing next queue item: "${nextItem.media.name}"...`);
        try {
          await this.openMedia({
            streamUrl: nextItem.stream?.url || '',
            title: nextItem.media.name,
            imdbId: nextItem.media.imdbId,
            type: (nextItem.media.type as 'movie' | 'series') || 'movie',
            quality: nextItem.stream?.quality || this.currentQuality,
            voiceChannelId: this.voiceChannelId || '',
            textChannelId: this.textChannelId || undefined,
          });
          return;
        } catch (err) {
          console.warn(`[WorkerSession:${this.guildId}] Queue item "${nextItem.media.name}" failed to start (${(err as Error).message}). Trying the next one...`);
        }
      }

      console.log(`[WorkerSession:${this.guildId}] No playable queue items remaining. Playback ended.`);
      this.playbackStatus = 'ENDED';
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
    // The playback clock is driven by a 1s wall-clock tick, so it can drift a
    // little past the end on a file whose real runtime we know. Clamp it so
    // the UI never reports a position beyond the movie's length.
    const position =
      this.duration > 0 ? Math.min(this.currentPosition, this.duration) : this.currentPosition;

    return {
      status: this.playbackStatus,
      title: this.currentTitle,
      currentTime: position,
      duration: this.duration,
      bufferedTime: this.duration > 0 ? Math.min(position + 30, this.duration) : position + 30,
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
      fps: this.outputFps,
      resolution: this.qualityLabel,
      stallCount: 0,
      errorMessage: this.errorMessage || undefined,
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
