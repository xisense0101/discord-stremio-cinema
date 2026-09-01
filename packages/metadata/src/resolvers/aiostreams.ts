import fetch from 'node-fetch';
import { MediaStream } from '../types.js';
import config from '@discord-stremio/config';

export class AIOStreamsResolver {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || config.torbox.aiostreamsUrl;
  }

  async resolveStreams(
    type: 'movie' | 'series',
    imdbId: string,
    season?: number,
    episode?: number
  ): Promise<MediaStream[]> {
    const id = type === 'series' && season && episode ? `${imdbId}:${season}:${episode}` : imdbId;
    const streams: MediaStream[] = [];

    try {
      const url = `${this.baseUrl}/stream/${type}/${id}.json`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'DiscordStremioPlayer/1.0' },
        timeout: 8000,
      } as any);

      if (res.ok) {
        const data = (await res.json()) as { streams?: any[] };
        if (data.streams && Array.isArray(data.streams)) {
          for (const s of data.streams) {
            streams.push({
              id: s.infoHash || s.url || Math.random().toString(36).substring(2, 9),
              name: s.name || 'AIOStreams',
              title: s.title || 'Aggregated Stream',
              quality: s.title?.includes('1080p') ? '1080p' : s.title?.includes('720p') ? '720p' : 'other',
              url: s.url,
              isCached: true,
              provider: 'AIOStreams',
              details: s.title,
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[AIOStreamsResolver] Resolve error:`, (err as Error).message);
    }

    return streams;
  }
}

export const aiostreamsResolver = new AIOStreamsResolver();
