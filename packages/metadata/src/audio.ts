import { AudioTrackInfo } from './types.js';

const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  en: 'English',
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
  zh: 'Chinese',
  ara: 'Arabic',
  ar: 'Arabic',
  tur: 'Turkish',
  tr: 'Turkish',
  pol: 'Polish',
  pl: 'Polish',
  dut: 'Dutch',
  nl: 'Dutch',
  swe: 'Swedish',
  sv: 'Swedish',
  dan: 'Danish',
  da: 'Danish',
  fin: 'Finnish',
  fi: 'Finnish',
  nor: 'Norwegian',
  no: 'Norwegian',
  ukr: 'Ukrainian',
  uk: 'Ukrainian',
  tam: 'Tamil',
  ta: 'Tamil',
  tel: 'Telugu',
  te: 'Telugu',
  mal: 'Malayalam',
  ml: 'Malayalam',
  und: 'Main Audio',
};

function formatChannelLayout(channels: number, layout?: string): string {
  if (channels === 6 || layout?.includes('5.1')) return '5.1 Surround';
  if (channels === 8 || layout?.includes('7.1')) return '7.1 Surround';
  if (channels === 2 || layout?.includes('stereo')) return 'Stereo';
  if (channels === 1 || layout?.includes('mono')) return 'Mono';
  return `${channels} Channels`;
}

/** Video characteristics of the source file, read from the same probe as the audio tracks. */
export interface SourceVideoInfo {
  /** Native frame rate of the source, e.g. 23.976 for most film releases */
  fps?: number;
  width?: number;
  height?: number;
  codec?: string;
}

/** Parses ffprobe's rational frame-rate strings ("24000/1001") into a number. */
function parseFrameRate(value?: string): number | undefined {
  if (!value) return undefined;
  const [num, den] = value.split('/').map(Number);
  if (!num || !den) return undefined;
  const fps = num / den;
  if (!Number.isFinite(fps) || fps <= 0 || fps > 480) return undefined;
  return Math.round(fps * 1000) / 1000;
}

/**
 * Fast probe of embedded audio streams from a media URL using ffprobe
 */
export async function probeEmbeddedAudioTracks(
  streamUrl: string,
  timeoutMs: number = 5000
): Promise<AudioTrackInfo[]> {
  return (await probeSourceMedia(streamUrl, timeoutMs)).audioTracks;
}

/**
 * Probes the source's audio tracks AND its video characteristics in a single
 * ffprobe pass. These are deliberately fetched together rather than by two
 * separate calls: the debrid CDN links this app plays only tolerate one
 * connection at a time, so every extra probe is both another connection and
 * another few seconds of start-up latency.
 */
export async function probeSourceMedia(
  streamUrl: string,
  timeoutMs: number = 5000
): Promise<{ audioTracks: AudioTrackInfo[]; video: SourceVideoInfo | null }> {
  try {
    const { spawn } = await import('child_process');

    const p = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-probesize', '5000000',
      '-analyzeduration', '3000000',
      '-headers', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n',
      streamUrl,
    ]);

    let stdout = '';
    p.stdout.on('data', (d) => (stdout += d));

    const exitCode = await Promise.race([
      new Promise<number>((resolve) => p.on('close', resolve)),
      new Promise<number>((resolve) => {
        setTimeout(() => {
          try { p.kill('SIGKILL'); } catch {}
          resolve(-1);
        }, timeoutMs);
      }),
    ]);

    if (exitCode !== 0 || !stdout) {
      return { audioTracks: [getDefaultAudioTrack()], video: null };
    }

    const data = JSON.parse(stdout);
    const allStreams: any[] = data.streams || [];

    // Cover art is carried as a video stream with an attached_pic disposition;
    // it is not the feature and must never be mistaken for it.
    const videoStream = allStreams.find(
      (s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1
    );
    const video: SourceVideoInfo | null = videoStream
      ? {
          fps: parseFrameRate(videoStream.avg_frame_rate) ?? parseFrameRate(videoStream.r_frame_rate),
          width: videoStream.width,
          height: videoStream.height,
          codec: videoStream.codec_name,
        }
      : null;

    // Filtered to audio BEFORE indexing: the index below is the audio-relative
    // one that `-map 0:a:N` expects, not the container-absolute stream index.
    const audioStreams = allStreams.filter((s) => s.codec_type === 'audio');

    if (audioStreams.length === 0) {
      return { audioTracks: [getDefaultAudioTrack()], video };
    }

    const tracks: AudioTrackInfo[] = audioStreams.map((s: any, audioIndex: number) => {
      const rawLang = (s.tags?.language || 'und').toLowerCase();
      const langName = LANGUAGE_NAMES[rawLang] || (rawLang !== 'und' ? rawLang.toUpperCase() : 'English');
      const channels = s.channels || 2;
      const channelLayoutStr = formatChannelLayout(channels, s.channel_layout);
      const codec = (s.codec_name || 'aac').toUpperCase();
      const customTitle = s.tags?.title || s.tags?.handler_name;
      const isDefault = s.disposition?.default === 1;

      let label = `${langName} (${channelLayoutStr} • ${codec})`;
      if (customTitle && !customTitle.toLowerCase().includes(rawLang)) {
        label = `${langName} - ${customTitle} (${channelLayoutStr})`;
      }

      return {
        id: String(audioIndex),
        audioStreamIndex: audioIndex,
        rawStreamIndex: s.index ?? audioIndex,
        language: langName,
        rawLanguage: rawLang,
        label,
        codec,
        channels,
        channelLayout: channelLayoutStr,
        title: customTitle,
        isDefault,
      };
    });

    return { audioTracks: tracks, video };
  } catch (err) {
    console.warn('[AudioProbe] Error probing audio tracks:', (err as Error).message);
    return { audioTracks: [getDefaultAudioTrack()], video: null };
  }
}

function getDefaultAudioTrack(): AudioTrackInfo {
  return {
    id: '0',
    audioStreamIndex: 0,
    rawStreamIndex: 0,
    language: 'English',
    rawLanguage: 'eng',
    label: 'Default Audio (Stereo)',
    codec: 'AAC',
    channels: 2,
    channelLayout: 'Stereo',
    isDefault: true,
  };
}
