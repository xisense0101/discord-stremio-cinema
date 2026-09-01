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
  const combined: MediaStream[] = [];

  // 1. Primary: AIOStreams Resolver
  if (config.torbox.resolverMode === 'aiostreams' || config.torbox.aiostreamsUrl) {
    try {
      const aioStreams = await aiostreamsResolver.resolveStreams(type, imdbId, season, episode, preferredQuality);
      if (aioStreams && aioStreams.length > 0) {
        combined.push(...aioStreams);
      }
    } catch (err) {
      console.warn('[ResolveMediaStreams] AIOStreams resolve warning:', (err as Error).message);
    }
  }

  // 2. TorBox Direct Scraper (Provides resilient fallback to non-IP-locked CDN streams)
  try {
    const torboxStreams = await torboxResolver.resolveStreams(type, imdbId, season, episode, preferredQuality);
    if (torboxStreams && torboxStreams.length > 0) {
      combined.push(...torboxStreams);
    }
  } catch (err) {
    console.warn('[ResolveMediaStreams] Torbox direct resolve warning:', (err as Error).message);
  }

  return combined;
}

export * from './torbox.js';
export * from './aiostreams.js';
