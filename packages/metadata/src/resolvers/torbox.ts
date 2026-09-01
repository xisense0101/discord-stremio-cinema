import fetch from 'node-fetch';
import { MediaStream } from '../types.js';
import config from '@discord-stremio/config';

const FALLBACK_TORBOX_API_KEY = '6eb85715-b543-41c3-ba65-25d0af51edd8';

export class TorBoxStreamResolver {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || config.torbox.apiKey || FALLBACK_TORBOX_API_KEY;
  }

  private getEffectiveApiKey(): string {
    return process.env.TORBOX_API_KEY || this.apiKey || config.torbox.apiKey || FALLBACK_TORBOX_API_KEY;
  }

  /**
   * Request direct CDN download/stream URL for a specific torrent hash from TorBox API
   */
  async resolveDirectTorboxStream(infoHash: string, fileIdx?: number): Promise<{ url: string; fileName?: string; sizeBytes?: number } | null> {
    const key = this.getEffectiveApiKey();
    if (!key || !infoHash) return null;

    try {
      const form = new URLSearchParams();
      form.append('magnet', infoHash.startsWith('magnet:') ? infoHash : `magnet:?xt=urn:btih:${infoHash}`);

      const createRes = await fetch('https://api.torbox.app/v1/api/torrents/createtorrent', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: AbortSignal.timeout(8000),
      });

      if (!createRes.ok) return null;
      const createData = (await createRes.json()) as any;
      const torrentId = createData.data?.torrent_id || createData.data?.id;
      if (!torrentId) return null;

      // Fetch torrent file list to pick the largest video file (not .txt or sample)
      let selectedFileId: number | undefined = fileIdx;
      let selectedFileName: string | undefined;
      let selectedFileSize: number | undefined;

      if (selectedFileId === undefined) {
        const listRes = await fetch(`https://api.torbox.app/v1/api/torrents/mylist?id=${torrentId}`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8000),
        });

        if (listRes.ok) {
          const listData = (await listRes.json()) as any;
          const files: any[] = listData.data?.files || [];
          if (Array.isArray(files) && files.length > 0) {
            // Find largest file with video extension / mimetype
            const videoFiles = files.filter((f) => {
              const name = (f.name || f.short_name || '').toLowerCase();
              const mime = (f.mimetype || '').toLowerCase();
              return (
                mime.startsWith('video/') ||
                name.endsWith('.mkv') ||
                name.endsWith('.mp4') ||
                name.endsWith('.avi') ||
                name.endsWith('.mov') ||
                name.endsWith('.webm') ||
                name.endsWith('.m4v')
              );
            });

            const candidates = videoFiles.length > 0 ? videoFiles : files;
            candidates.sort((a, b) => (b.size || 0) - (a.size || 0));
            selectedFileId = candidates[0].id;
            selectedFileName = candidates[0].short_name || candidates[0].name;
            selectedFileSize = candidates[0].size;
          }
        }
      }

      const fileParam = selectedFileId !== undefined ? `&file_id=${selectedFileId}` : '';
      const dlRes = await fetch(`https://api.torbox.app/v1/api/torrents/requestdl?token=${key}&torrent_id=${torrentId}${fileParam}&zip=false`, {
        signal: AbortSignal.timeout(8000),
      });

      if (!dlRes.ok) return null;
      const dlData = (await dlRes.json()) as any;
      if (typeof dlData.data === 'string' && dlData.data.startsWith('http')) {
        return {
          url: dlData.data,
          fileName: selectedFileName,
          sizeBytes: selectedFileSize,
        };
      }
    } catch (err) {
      console.warn('[TorBoxDirect] Error resolving direct stream:', (err as Error).message);
    }
    return null;
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
    const key = this.getEffectiveApiKey();

    // 1. Primary: Torrentio with TorBox Debrid configured
    const torrentioBase = key ? `https://torrentio.strem.fun/torbox=${key}` : 'https://torrentio.strem.fun';

    try {
      const url = `${torrentioBase}/stream/${type}/${id}.json`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(8000),
      });

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
    const ranked = this.rankStreams(streams, preferredQuality);

    // If top streams only have Torrentio resolve URLs or infoHashes, preemptively resolve the direct TorBox CDN URL for the top cached stream
    if (ranked.length > 0 && ranked[0].infoHash) {
      try {
        const directCdn = await this.resolveDirectTorboxStream(ranked[0].infoHash, ranked[0].fileIdx);
        if (directCdn && directCdn.url) {
          ranked[0].url = directCdn.url;
        }
      } catch {}
    }

    return ranked;
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
    // Check 4K / 2160p first to avoid false matching from HDR10 / UHD
    if (/\b(4k|2160p|uhd|ultrahd)\b/i.test(fullText) || fullText.includes('2160p') || fullText.includes('4k')) {
      quality = '4k';
    } else if (/\b(1080p|1080i|1920x1080|fhd|fullhd)\b/i.test(fullText) || fullText.includes('1080p')) {
      quality = '1080p';
    } else if (/\b(720p|1280x720)\b/i.test(fullText) || fullText.includes('720p') || fullText.includes('1280x720') || (/\bhd\b/i.test(fullText) && !/\b(hdr|uhd|fullhd|hdrip)\b/i.test(fullText))) {
      quality = '720p';
    } else if (/\b(480p|576p|dvdrip|sd)\b/i.test(fullText) || fullText.includes('480p')) {
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
      title: raw.title || raw.name || 'Stream',
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

  private rankStreams(streams: MediaStream[], preferredQuality: string = '720p'): MediaStream[] {
    const pref = preferredQuality.toLowerCase().trim();
    let qualityPriority: Record<string, number> = { '720p': 1, '1080p': 2, '480p': 3, '4k': 4, 'other': 5 };

    if (pref === '4k' || pref === '2160p' || pref === 'uhd') {
      qualityPriority = { '4k': 1, '1080p': 2, '720p': 3, '480p': 4, 'other': 5 };
    } else if (pref === '2k' || pref === '1440p' || pref === 'qhd') {
      qualityPriority = { '4k': 1, '1080p': 2, '720p': 3, '480p': 4, 'other': 5 };
    } else if (pref === '1080p' || pref === 'fhd') {
      qualityPriority = { '1080p': 1, '720p': 2, '480p': 3, '4k': 4, 'other': 5 };
    } else if (pref === '720p' || pref === 'hd') {
      qualityPriority = { '720p': 1, '1080p': 2, '480p': 3, '4k': 4, 'other': 5 };
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
