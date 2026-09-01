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

    const seenLanguages = new Set<string>();
    const tracks: SubtitleTrackInfo[] = [];

    for (const sub of data.subtitles) {
      if (!sub.url || !sub.lang) continue;
      const langCode = sub.lang.toLowerCase();
      const friendlyName = LANGUAGE_NAMES[langCode] || langCode.toUpperCase();

      if (!seenLanguages.has(friendlyName)) {
        seenLanguages.add(friendlyName);
        tracks.push({
          id: sub.id ? String(sub.id) : friendlyName,
          lang: friendlyName,
          url: sub.url,
          format: sub.format || 'srt',
        });
      }
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
