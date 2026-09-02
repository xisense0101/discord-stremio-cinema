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

/**
 * Fast probe of embedded audio streams from a media URL using ffprobe
 */
export async function probeEmbeddedAudioTracks(
  streamUrl: string,
  timeoutMs: number = 5000
): Promise<AudioTrackInfo[]> {
  try {
    const { spawn } = await import('child_process');

    const p = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 'a',
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
      return [getDefaultAudioTrack()];
    }

    const data = JSON.parse(stdout);
    const audioStreams = data.streams || [];

    if (audioStreams.length === 0) {
      return [getDefaultAudioTrack()];
    }

    const tracks: AudioTrackInfo[] = audioStreams.map((s: any, audioIndex: number) => {
      const rawLang = (s.tags?.language || 'und').toLowerCase();
      const langName = LANGUAGE_NAMES[rawLang] || (rawLang !== 'und' ? rawLang.toUpperCase() : 'English');
      const channels = s.channels || 2;
      const channelLayoutStr = formatChannelLayout(channels, s.channel_layout);
      const codec = (s.codec_name || 'aac').toUpperCase();
      const customTitle = s.tags?.title || s.tags?.handler_name;

      let label = `${langName} (${channelLayoutStr} • ${codec})`;
      if (customTitle && !customTitle.toLowerCase().includes(rawLang)) {
        label = `${langName} - ${customTitle} (${channelLayoutStr})`;
      }

      return {
        id: String(audioIndex),
        audioStreamIndex: audioIndex,
        rawStreamIndex: s.index ?? audioIndex,
        language: langName,
        label,
        codec,
        channels,
        channelLayout: channelLayoutStr,
        title: customTitle,
      };
    });

    return tracks;
  } catch (err) {
    console.warn('[AudioProbe] Error probing audio tracks:', (err as Error).message);
    return [getDefaultAudioTrack()];
  }
}

function getDefaultAudioTrack(): AudioTrackInfo {
  return {
    id: '0',
    audioStreamIndex: 0,
    rawStreamIndex: 0,
    language: 'English',
    label: 'Default Audio (Stereo)',
    codec: 'AAC',
    channels: 2,
    channelLayout: 'Stereo',
  };
}
