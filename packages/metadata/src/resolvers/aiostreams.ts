import { MediaStream } from '../types.js';
import config from '@discord-stremio/config';

export class AIOStreamsResolver {
  private getBaseUrl(): string {
    let url = config.torbox.aiostreamsUrl || 'https://aiostreams.elfhosted.com/stremio/7ed277cb-23c5-47c7-bed8-422e3095a99f/eyJpIjoicndwc3NHYXF6RFZ3b0YzUXpZY0JEQT09IiwiZSI6ImRiZVpDK21TeHgwVTBjV0REYk5CRmt5cVFkVzBrOWhObGNCNHZhYXBtVHM9IiwidCI6ImEifQ';
    if (url.endsWith('/manifest.json')) {
      url = url.substring(0, url.length - '/manifest.json'.length);
    }
    return url.replace(/\/+$/, '');
  }

  /**
   * Resolves streams straight from AIOStreams and returns them in the exact
   * order AIOStreams provides - it already sorts/filters according to
   * whatever the user configured in their AIOStreams manifest (quality,
   * cached status, language, etc). We used to re-rank everything ourselves
   * with a regex-based quality/language guesser; that duplicated logic
   * AIOStreams already does properly, and its language classifier had a
   * real bug (verified against a live "How to Train Your Dragon" release)
   * where a bracketed multi-dub tag like "[Tam + Tel + Hin + Eng]" got
   * misclassified as plain English and ranked identically to real
   * English-only sources. Don't re-implement AIOStreams' job here.
   */
  async resolveStreams(
    type: 'movie' | 'series',
    imdbId: string,
    season?: number,
    episode?: number,
    _preferredQuality: string = '720p'
  ): Promise<MediaStream[]> {
    const id = type === 'series' && season && episode ? `${imdbId}:${season}:${episode}` : imdbId;
    const streams: MediaStream[] = [];
    const baseUrl = this.getBaseUrl();

    try {
      const url = `${baseUrl}/stream/${type}/${id}.json`;
      console.log(`[AIOStreamsResolver] Fetching streams for ${type} ${id} from AIOStreams: ${url}`);

      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = (await res.json()) as { streams?: any[] };
        if (data.streams && Array.isArray(data.streams)) {
          for (const s of data.streams) {
            const parsed = this.parseStream(s);
            if (parsed) {
              streams.push(parsed);
            }
          }
        }
      } else {
        console.warn(`[AIOStreamsResolver] HTTP Error ${res.status} from ${url}`);
      }
    } catch (err) {
      console.warn(`[AIOStreamsResolver] Resolve error:`, (err as Error).message);
    }

    return streams;
  }

  /**
   * Extracts display metadata (quality/audio format/size) from an AIOStreams
   * entry for the UI. Only filters out obviously unwatchable CAM/TS/Screener
   * rips - does not re-order or re-score anything.
   */
  private parseStream(raw: any): MediaStream | null {
    if (!raw.url) return null;

    const rawName = raw.name || 'AIOStreams';
    const rawTitle = raw.title || '';
    const filename = raw.behaviorHints?.filename || rawTitle || rawName;
    const fullText = `${rawName} ${rawTitle} ${filename}`.toLowerCase();

    // Filter out CAM, TS, Telesync, Screener
    if (
      fullText.includes('cam') ||
      fullText.includes('telesync') ||
      fullText.includes('hdcam') ||
      fullText.includes('hd-ts') ||
      fullText.includes('screener') ||
      fullText.includes('scr')
    ) {
      return null;
    }

    // Parse Quality (display/filter metadata only)
    let quality: MediaStream['quality'] = 'other';
    if (/\b(4k|2160p|uhd|ultrahd)\b/i.test(fullText) || fullText.includes('2160p') || fullText.includes('4k')) {
      quality = '4k';
    } else if (/\b(1080p|1080i|1920x1080|fhd|fullhd)\b/i.test(fullText) || fullText.includes('1080p')) {
      quality = '1080p';
    } else if (/\b(720p|1280x720)\b/i.test(fullText) || fullText.includes('720p') || fullText.includes('1280x720') || (/\bhd\b/i.test(fullText) && !/\b(hdr|uhd|fullhd|hdrip)\b/i.test(fullText))) {
      quality = '720p';
    } else if (/\b(480p|576p|dvdrip|sd)\b/i.test(fullText) || fullText.includes('480p')) {
      quality = '480p';
    }

    // Parse Size
    let sizeBytes = raw.behaviorHints?.videoSize || 0;
    if (!sizeBytes || sizeBytes <= 0) {
      const sizeMatch = fullText.match(/([0-9.]+)\s*gb/);
      if (sizeMatch) {
        sizeBytes = Math.round(parseFloat(sizeMatch[1]) * 1024 * 1024 * 1024);
      }
    }

    // Parse Audio format (channel layout label only, not a language guess)
    let audio = 'Stereo';
    if (fullText.includes('atmos') || fullText.includes('truehd') || fullText.includes('dts-hd') || fullText.includes('7.1')) {
      audio = 'Surround 7.1 (Lossless)';
    } else if (fullText.includes('dd+5.1') || fullText.includes('eac3') || fullText.includes('dts') || fullText.includes('5.1')) {
      audio = 'Dolby 5.1 Surround';
    } else if (fullText.includes('aac') || fullText.includes('mp4a') || fullText.includes('stereo') || fullText.includes('2.0')) {
      audio = 'AAC Stereo';
    }

    const displayTitle = filename.replace(/\.[a-zA-Z0-9]+$/, '') || rawName;

    return {
      id: raw.url || Math.random().toString(36).substring(2, 9),
      name: rawName,
      title: displayTitle,
      quality,
      resolution: quality,
      isCached: true,
      provider: 'AIOStreams [TB+]',
      audio,
      url: raw.url,
      sizeBytes,
      details: audio,
    };
  }
}

export const aiostreamsResolver = new AIOStreamsResolver();
