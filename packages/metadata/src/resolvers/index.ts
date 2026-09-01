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
  if (config.torbox.resolverMode === 'aiostreams') {
    const aioStreams = await aiostreamsResolver.resolveStreams(type, imdbId, season, episode);
    if (aioStreams.length > 0) return aioStreams;
  }

  // Default to Direct TorBox / Torrentio-TorBox
  return torboxResolver.resolveStreams(type, imdbId, season, episode, preferredQuality);
}

export * from './torbox.js';
export * from './aiostreams.js';
