import config from '@discord-stremio/config';
import { MediaStream } from '../types.js';
import { torboxResolver } from './torbox.js';
import { aiostreamsResolver } from './aiostreams.js';

export async function resolveMediaStreams(
  type: 'movie' | 'series',
  imdbId: string,
  season?: number,
  episode?: number,
  preferredQuality?: string
): Promise<MediaStream[]> {
  // 1. Primary: AIOStreams Resolver
  if (config.torbox.resolverMode === 'aiostreams' || config.torbox.aiostreamsUrl) {
    try {
      const aioStreams = await aiostreamsResolver.resolveStreams(type, imdbId, season, episode, preferredQuality);
      if (aioStreams.length > 0) {
        return aioStreams;
      }
    } catch (err) {
      console.warn('[ResolveMediaStreams] AIOStreams resolve warning:', (err as Error).message);
    }
  }

  // 2. Fallback: Direct TorBox / Torrentio Scraper
  return torboxResolver.resolveStreams(type, imdbId, season, episode, preferredQuality);
}

export * from './torbox.js';
export * from './aiostreams.js';
