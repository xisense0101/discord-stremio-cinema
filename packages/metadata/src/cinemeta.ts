import fetch from 'node-fetch';
import { MediaItem } from './types.js';

const CINEMETA_URL = 'https://v3-cinemeta.strem.io';
const CINEMETA_BACKUP_URL = 'https://cinemeta-catalogs.strem.io';

export class CinemetaClient {
  /**
   * Search for movies and series with resilient multi-tier fallback (IMDb Suggester + Cinemeta)
   */
  async searchMedia(query: string, type: 'movie' | 'series' = 'movie'): Promise<MediaItem[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) return [];

    // 1. Primary High-Speed & Typo-Tolerant Search: Official IMDb Suggestions Engine
    try {
      const firstChar = cleanQuery.charAt(0).toLowerCase();
      const sanitized = encodeURIComponent(cleanQuery.toLowerCase().replace(/[^a-z0-9]/g, '_'));
      const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${sanitized}.json`;

      const res = await fetch(imdbUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 4000,
      } as any);

      if (res.ok) {
        const data = (await res.json()) as { d?: any[] };
        if (data.d && Array.isArray(data.d)) {
          const filtered = data.d.filter((item) => item.id && item.id.startsWith('tt') && item.l);
          if (filtered.length > 0) {
            return filtered.map((item) => ({
              id: item.id,
              imdbId: item.id,
              type: (item.qid === 'tvSeries' || item.qid === 'tvMiniSeries' || item.q === 'TV series') ? 'series' : 'movie',
              name: item.l,
              releaseInfo: item.y ? String(item.y) : undefined,
              poster: item.i?.imageUrl,
              description: item.s ? `Starring: ${item.s}` : undefined,
              rating: item.rank ? `#${item.rank} on IMDb` : undefined,
            }));
          }
        }
      }
    } catch (err) {
      console.warn(`[Cinemeta] IMDb suggestion fallback notice:`, (err as Error).message);
    }

    // 2. Secondary Search: Cinemeta Primary Endpoint
    const encodedQuery = encodeURIComponent(cleanQuery);
    try {
      const url = `${CINEMETA_URL}/catalog/${type}/top/search=${encodedQuery}.json`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'DiscordStremioPlayer/1.0' },
        timeout: 5000,
      } as any);

      if (res.ok) {
        const data = (await res.json()) as { metas?: any[] };
        if (data.metas && Array.isArray(data.metas) && data.metas.length > 0) {
          return this.parseCinemetaMetas(data.metas, type);
        }
      }
    } catch (err) {
      console.warn(`[Cinemeta] Cinemeta primary search error:`, (err as Error).message);
    }

    // 3. Tertiary Search: Cinemeta Backup Catalogs
    try {
      const url = `${CINEMETA_BACKUP_URL}/catalog/${type}/top/search=${encodedQuery}.json`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'DiscordStremioPlayer/1.0' },
        timeout: 5000,
      } as any);

      if (res.ok) {
        const data = (await res.json()) as { metas?: any[] };
        if (data.metas && Array.isArray(data.metas) && data.metas.length > 0) {
          return this.parseCinemetaMetas(data.metas, type);
        }
      }
    } catch (err) {
      console.warn(`[Cinemeta] Cinemeta backup search error:`, (err as Error).message);
    }

    return [];
  }

  private parseCinemetaMetas(metas: any[], fallbackType: 'movie' | 'series'): MediaItem[] {
    return metas.map((item) => ({
      id: item.id || item.imdb_id,
      imdbId: item.imdb_id || item.id,
      type: (item.type as 'movie' | 'series') || fallbackType,
      name: item.name || 'Unknown Title',
      releaseInfo: item.releaseInfo || (item.year ? String(item.year) : undefined),
      poster: item.poster,
      background: item.background,
      description: item.description,
      genres: item.genres || item.genre || [],
      cast: item.cast || item.director || [],
      rating: item.imdbRating,
      runtime: item.runtime,
    }));
  }

  /**
   * Fetch full metadata for a specific IMDB ID
   */
  async getMediaDetails(type: 'movie' | 'series', imdbId: string): Promise<MediaItem | null> {
    const url = `${CINEMETA_URL}/meta/${type}/${imdbId}.json`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'DiscordStremioPlayer/1.0' },
        timeout: 6000,
      } as any);

      if (res.ok) {
        const data = (await res.json()) as { meta?: any };
        if (data.meta) {
          const item = data.meta;
          return {
            id: item.id || item.imdb_id || imdbId,
            imdbId: item.imdb_id || item.id || imdbId,
            type: (item.type as 'movie' | 'series') || type,
            name: item.name || 'Unknown Title',
            releaseInfo: item.releaseInfo || (item.year ? String(item.year) : undefined),
            poster: item.poster,
            background: item.background,
            description: item.description,
            genres: item.genres || item.genre || [],
            cast: item.cast || [],
            rating: item.imdbRating,
            runtime: item.runtime,
          };
        }
      }
    } catch (err) {
      console.warn(`[Cinemeta] Get details notice for ID "${imdbId}":`, (err as Error).message);
    }
    return null;
  }
}

export const cinemeta = new CinemetaClient();
