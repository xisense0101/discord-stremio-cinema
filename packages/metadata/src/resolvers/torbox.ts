import fetch from 'node-fetch';
import { MediaStream } from '../types.js';
import config from '@discord-stremio/config';

export class TorBoxStreamResolver {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || config.torbox.apiKey;
  }

  /**
   * Resolve streams for a given IMDB item
   */
  async resolveStreams(
    type: 'movie' | 'series',
    imdbId: string,
    season?: number,
    episode?: number,
    preferredQuality?: string
  ): Promise<MediaStream[]> {
    const id = type === 'series' && season && episode ? `${imdbId}:${season}:${episode}` : imdbId;
    const streams: MediaStream[] = [];

    // 1. Primary: Torrentio with TorBox Debrid configured
    const torrentioBase = this.apiKey
      ? `https://torrentio.strem.fun/torbox=${this.apiKey}`
      : 'https://torrentio.strem.fun';

    try {
      const url = `${torrentioBase}/stream/${type}/${id}.json`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'DiscordStremioPlayer/1.0' },
        timeout: 8000,
      } as any);

      if (res.ok) {
        const data = (await res.json()) as { streams?: any[] };
        if (data.streams && Array.isArray(data.streams)) {
          for (const s of data.streams) {
            const parsed = this.parseStreamDescriptor(s, 'Torrentio-TorBox');
            if (parsed) streams.push(parsed);
          }
        }
      }
    } catch (err) {
      console.warn(`[TorBoxResolver] Torrentio resolve error:`, (err as Error).message);
    }

    // Sort streams: cached first with preferred quality and supported audio, filter out CAM/TS
    return this.rankStreams(streams, preferredQuality);
  }

  private parseStreamDescriptor(raw: any, provider: string): MediaStream | null {
    const rawName = raw.name || '';
    const rawTitle = raw.title || '';
    const rawDesc = raw.description || '';
    const fullText = `${rawName} ${rawTitle} ${rawDesc}`.toLowerCase();

    // Section 22: Filter out CAM, TS, Telesync, HDCAM, Screener
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

    let quality: MediaStream['quality'] = 'other';
    if (fullText.includes('1080p') || fullText.includes('1920x1080') || fullText.includes('fhd')) {
      quality = '1080p';
    } else if (fullText.includes('720p') || fullText.includes('1280x720') || fullText.includes('hd')) {
      quality = '720p';
    } else if (fullText.includes('2160p') || fullText.includes('4k') || fullText.includes('uhd')) {
      quality = '4k';
    } else if (fullText.includes('480p') || fullText.includes('sd')) {
      quality = '480p';
    }

    const isCached =
      rawName.includes('[TB+]') ||
      rawName.includes('[TB]') ||
      fullText.includes('⚡') ||
      fullText.includes('cached') ||
      fullText.includes('torbox');

    // Parse audio format
    let audio = 'Stereo';
    let audioScore = 1;
    if (fullText.includes('aac') || fullText.includes('mp4a') || fullText.includes('stereo') || fullText.includes('2.0')) {
      audio = 'AAC Stereo';
      audioScore = 3;
    } else if (fullText.includes('dd+5.1') || fullText.includes('eac3') || fullText.includes('5.1')) {
      audio = 'Dolby 5.1';
      audioScore = 2;
    } else if (fullText.includes('dts') || fullText.includes('atmos') || fullText.includes('7.1')) {
      audio = 'Surround 7.1';
      audioScore = 1;
    }

    // Parse size in GB
    let sizeGB = 2.5;
    const sizeMatch = fullText.match(/([0-9.]+)\s*gb/);
    if (sizeMatch) {
      sizeGB = parseFloat(sizeMatch[1]);
    }

    const directUrl = raw.url || (raw.infoHash ? `magnet:?xt=urn:btih:${raw.infoHash}` : '');

    return {
      id: raw.infoHash || raw.url || Math.random().toString(36).substring(2, 9),
      name: raw.name || 'TorBox Stream',
      title: raw.title || raw.name || '1080p Stream',
      quality,
      resolution: quality,
      isCached,
      provider: rawName.includes('[TB+]') ? 'TorBox Cached ⚡' : provider,
      audio,
      url: directUrl,
      infoHash: raw.infoHash,
      fileIdx: raw.fileIdx,
      details: rawTitle || rawDesc,
      sizeBytes: Math.round(sizeGB * 1024 * 1024 * 1024),
    };
  }

  private rankStreams(streams: MediaStream[], preferredQuality: string = '1080p'): MediaStream[] {
    const pref = preferredQuality.toLowerCase().trim();
    let qualityPriority: Record<string, number> = { '1080p': 1, '720p': 2, '4k': 3, '480p': 4, 'other': 5 };

    if (pref === '4k' || pref === '2160p' || pref === 'uhd') {
      qualityPriority = { '4k': 1, '1080p': 2, '720p': 3, '480p': 4, 'other': 5 };
    } else if (pref === '2k' || pref === '1440p' || pref === 'qhd') {
      qualityPriority = { '4k': 1, '1080p': 2, '720p': 3, '480p': 4, 'other': 5 };
    } else if (pref === '720p' || pref === 'hd') {
      qualityPriority = { '720p': 1, '1080p': 2, '4k': 3, '480p': 4, 'other': 5 };
    } else if (pref === '480p' || pref === 'sd') {
      qualityPriority = { '480p': 1, '720p': 2, '1080p': 3, '4k': 4, 'other': 5 };
    }

    return streams.sort((a, b) => {
      // 1. Cached takes top precedence
      if (a.isCached && !b.isCached) return -1;
      if (!a.isCached && b.isCached) return 1;

      // 2. Preferred quality prioritized
      const rankA = qualityPriority[a.quality] || 99;
      const rankB = qualityPriority[b.quality] || 99;
      if (rankA !== rankB) return rankA - rankB;

      // 3. Optimal file size priority (~1.5 GB to 8.0 GB for buffer-free streaming)
      const sizeA = (a.sizeBytes || 0) / (1024 * 1024 * 1024);
      const sizeB = (b.sizeBytes || 0) / (1024 * 1024 * 1024);

      const isIdealSizeA = sizeA >= 1.5 && sizeA <= 8.0;
      const isIdealSizeB = sizeB >= 1.5 && sizeB <= 8.0;
      if (isIdealSizeA && !isIdealSizeB) return -1;
      if (!isIdealSizeA && isIdealSizeB) return 1;

      return 0;
    });
  }
}

export const torboxResolver = new TorBoxStreamResolver();
