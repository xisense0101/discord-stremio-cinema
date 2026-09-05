import fs from 'fs';
import path from 'path';
import { SubtitleTrackInfo } from './types.js';

const OPENSUBTITLES_URL = 'https://opensubtitles-v3.strem.io';

const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  en: 'English',
  'en-sdh': 'English (SDH)',
  spa: 'Spanish',
  es: 'Spanish',
  fre: 'French',
  fra: 'French',
  fr: 'French',
  ger: 'German',
  deu: 'German',
  de: 'German',
  ita: 'Italian',
  it: 'Italian',
  por: 'Portuguese',
  pob: 'Portuguese (Brazil)',
  pt: 'Portuguese',
  rus: 'Russian',
  ru: 'Russian',
  hin: 'Hindi',
  hi: 'Hindi',
  nep: 'Nepali',
  ne: 'Nepali',
  jpn: 'Japanese',
  ja: 'Japanese',
  kor: 'Korean',
  ko: 'Korean',
  chi: 'Chinese',
  zho: 'Chinese',
  zht: 'Chinese (Traditional)',
  zh: 'Chinese',
  ara: 'Arabic',
  ar: 'Arabic',
  tur: 'Turkish',
  tr: 'Turkish',
  pol: 'Polish',
  pl: 'Polish',
  dut: 'Dutch',
  nld: 'Dutch',
  nl: 'Dutch',
  swe: 'Swedish',
  sv: 'Swedish',
  dan: 'Danish',
  da: 'Danish',
  fin: 'Finnish',
  fi: 'Finnish',
  nor: 'Norwegian',
  no: 'Norwegian',
  gre: 'Greek',
  ell: 'Greek',
  el: 'Greek',
  heb: 'Hebrew',
  he: 'Hebrew',
  tha: 'Thai',
  th: 'Thai',
  vie: 'Vietnamese',
  vi: 'Vietnamese',
  ind: 'Indonesian',
  id: 'Indonesian',
  ukr: 'Ukrainian',
  uk: 'Ukrainian',
  ces: 'Czech',
  cze: 'Czech',
  cs: 'Czech',
  hun: 'Hungarian',
  hu: 'Hungarian',
  ron: 'Romanian',
  ro: 'Romanian',
};

export async function fetchAvailableSubtitles(
  imdbId: string,
  type: 'movie' | 'series' = 'movie'
): Promise<SubtitleTrackInfo[]> {
  try {
    const url = `${OPENSUBTITLES_URL}/subtitles/${type}/${imdbId}.json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'DiscordStremioPlayer/1.0' },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as { subtitles?: any[] };
    if (!data.subtitles || !Array.isArray(data.subtitles)) return [];

    // Every candidate is kept, not just the first per language.
    //
    // OpenSubtitles carries many files per film, each timed for a particular
    // release and frame rate, and they are not interchangeable. Collapsing to
    // the first entry for a language threw away the alternatives along with
    // the two fields that decide whether a subtitle is actually in sync -
    // fpsMilli and movieReleaseName - so playback got an arbitrary file and
    // was as likely as not to drift. Selection now happens later, in the
    // worker, where the source's real frame rate and release name are known.
    const tracks: SubtitleTrackInfo[] = [];

    for (const sub of data.subtitles) {
      if (!sub.url || !sub.lang) continue;
      const langCode = sub.lang.toLowerCase();
      const friendlyName = LANGUAGE_NAMES[langCode] || langCode.toUpperCase();

      tracks.push({
        id: sub.id ? String(sub.id) : `${friendlyName}-${tracks.length}`,
        lang: friendlyName,
        url: sub.url,
        format: sub.format || 'srt',
        fps: typeof sub.fpsMilli === 'number' && sub.fpsMilli > 0 ? sub.fpsMilli / 1000 : undefined,
        releaseName: sub.movieReleaseName || undefined,
        fileName: sub.subtitleFileName || undefined,
      });
    }

    return tracks;
  } catch (err) {
    console.warn('[Subtitles] Error querying OpenSubtitles:', (err as Error).message);
    return [];
  }
}

export async function probeEmbeddedSubtitles(streamUrl: string): Promise<SubtitleTrackInfo[]> {
  try {
    const { spawn } = await import('child_process');
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-headers', 'User-Agent: DiscordStremioPlayer/1.0\r\n',
      '-show_entries', 'stream=index,codec_name,codec_type:stream_tags=language,title',
      '-of', 'json',
      streamUrl,
    ]);

    let stdout = '';
    p.stdout.on('data', (d) => (stdout += d));

    const exitCode = await new Promise<number>((resolve) => p.on('close', resolve));
    if (exitCode !== 0 || !stdout) return [];

    const data = JSON.parse(stdout);
    const subStreams = data.streams?.filter((s: any) => {
      if (s.codec_type !== 'subtitle') return false;
      const c = (s.codec_name || '').toLowerCase();
      return c === 'subrip' || c === 'ass' || c === 'ssa' || c === 'mov_text' || c === 'webvtt' || c === 'text';
    }) || [];

    const tracks: SubtitleTrackInfo[] = [];
    subStreams.forEach((s: any) => {
      const rawLang = (s.tags?.language || 'und').toLowerCase();
      const friendlyName = LANGUAGE_NAMES[rawLang] || rawLang.toUpperCase();
      const title = s.tags?.title ? ` (${s.tags.title})` : '';
      const label = `${friendlyName}${title} [Embedded ⚡]`;

      tracks.push({
        id: `embed_${s.index}`,
        lang: label,
        isEmbedded: true,
        streamIndex: s.index,
        codec: s.codec_name,
        format: s.codec_name === 'ass' || s.codec_name === 'ssa' ? 'ass' : 'srt',
      });
    });

    return tracks;
  } catch (err) {
    console.warn('[Subtitles] Embedded probe error:', (err as Error).message);
    return [];
  }
}

export async function extractEmbeddedSubtitle(
  streamUrl: string,
  streamIndex: number,
  targetPath: string,
  timeoutMs: number = 2500
): Promise<boolean> {
  try {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const { spawn } = await import('child_process');
    const p = spawn('ffmpeg', [
      '-y',
      '-headers', 'User-Agent: DiscordStremioPlayer/1.0\r\n',
      '-i', streamUrl,
      '-map', `0:${streamIndex}`,
      '-c:s', 'copy',
      targetPath,
    ]);

    const exitCode = await Promise.race([
      new Promise<number>((resolve) => p.on('close', resolve)),
      new Promise<number>((resolve) => {
        setTimeout(() => {
          try { p.kill('SIGKILL'); } catch {}
          resolve(-1);
        }, timeoutMs);
      }),
    ]);

    return exitCode === 0 && fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0;
  } catch (err) {
    console.error('[Subtitles] Error extracting embedded subtitle:', err);
    return false;
  }
}

/** Words that say nothing about which release a file is - ignored when matching. */
const RELEASE_STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of', 'movie', 'film', 'srt', 'sub', 'subs']);

function releaseTokens(text: string): Set<string> {
  return new Set(
    (text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !RELEASE_STOPWORDS.has(t))
  );
}

/**
 * Chooses the subtitle most likely to actually be in sync with the file being
 * played, rather than whichever happened to come first.
 *
 * Frame rate dominates the score because it is the only mismatch that gets
 * worse as the film runs: a 25fps subtitle against a 23.976fps source drifts
 * about five minutes by the end of a two hour movie. Release name is the
 * next signal, since a subtitle cut for the same release lines up with its
 * intro and any inserted logos.
 */
export function pickBestSubtitle(
  candidates: SubtitleTrackInfo[],
  opts: { sourceFps?: number; sourceRelease?: string }
): SubtitleTrackInfo | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const wanted = releaseTokens(opts.sourceRelease || '');

  const score = (sub: SubtitleTrackInfo): number => {
    let s = 0;

    if (opts.sourceFps && sub.fps) {
      const drift = Math.abs(sub.fps - opts.sourceFps) / opts.sourceFps;
      if (drift < 0.002) s += 100;
      else if (drift < 0.02) s += 40;
      else s -= 50;
    } else if (!sub.fps) {
      // Unknown frame rate is not a red flag: most subtitles carry no fps and
      // are timed for the common 23.976 release.
      s += 10;
    }

    if (wanted.size > 0) {
      const have = releaseTokens(`${sub.releaseName || ''} ${sub.fileName || ''}`);
      let overlap = 0;
      for (const t of have) if (wanted.has(t)) overlap++;
      s += Math.min(overlap, 6) * 8;
    }

    return s;
  };

  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

const SRT_TIME = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/g;

/**
 * Rewrites an SRT's timestamps for a different frame rate.
 *
 * When a subtitle timed at one frame rate is shown over a video at another,
 * the error grows linearly with runtime, so it cannot be corrected by any
 * fixed delay - it has to be rescaled. Times are multiplied by
 * subtitleFps / videoFps: 25fps subtitles over a 23.976fps film stretch by
 * about 4.3%.
 */
export function rescaleSrtForFps(filePath: string, subtitleFps: number, videoFps: number): boolean {
  try {
    if (!subtitleFps || !videoFps) return false;
    const ratio = subtitleFps / videoFps;
    if (!Number.isFinite(ratio) || Math.abs(ratio - 1) < 0.002) return false;

    const fmt = (totalMs: number): string => {
      const ms = Math.max(0, Math.round(totalMs));
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const milli = ms % 1000;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
    };

    const content = fs.readFileSync(filePath, 'utf-8');
    const scaled = content.replace(
      SRT_TIME,
      (_m, h1, m1, s1, ms1, h2, m2, s2, ms2) => {
        const start = ((+h1 * 60 + +m1) * 60 + +s1) * 1000 + +ms1;
        const end = ((+h2 * 60 + +m2) * 60 + +s2) * 1000 + +ms2;
        return `${fmt(start * ratio)} --> ${fmt(end * ratio)}`;
      }
    );

    fs.writeFileSync(filePath, scaled, 'utf-8');
    return true;
  } catch (err) {
    console.warn('[Subtitles] Frame-rate rescale notice:', (err as Error).message);
    return false;
  }
}

export async function downloadSubtitleFile(url: string, targetPath: string): Promise<boolean> {
  try {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const res = await fetch(url, {
      headers: { 'User-Agent': 'DiscordStremioPlayer/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return false;

    const content = await res.text();
    fs.writeFileSync(targetPath, content, 'utf-8');
    return true;
  } catch (err) {
    console.error('[Subtitles] Error downloading subtitle file:', err);
    return false;
  }
}
