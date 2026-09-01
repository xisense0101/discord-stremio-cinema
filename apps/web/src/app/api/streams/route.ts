import { NextRequest, NextResponse } from 'next/server';
import { resolveMediaStreams } from '@discord-stremio/metadata';
import { getStoredSettings } from '@/lib/settings-store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const imdbId = searchParams.get('imdbId') || searchParams.get('id');
    const type = (searchParams.get('type') as 'movie' | 'series') || 'movie';
    const season = searchParams.get('season') ? parseInt(searchParams.get('season')!, 10) : undefined;
    const episode = searchParams.get('episode') ? parseInt(searchParams.get('episode')!, 10) : undefined;

    if (!imdbId) {
      return NextResponse.json({ success: false, error: 'imdbId query param is required' }, { status: 400 });
    }

    const settings = getStoredSettings();
    const preferredQuality = settings.defaultQuality || '720p';

    console.log(`[API:Streams] Resolving all cached debrid streams for ${type} ${imdbId} (Preferred: ${preferredQuality})...`);
    const streams = await resolveMediaStreams(type, imdbId, season, episode, preferredQuality);

    return NextResponse.json({
      success: true,
      imdbId,
      type,
      total: streams.length,
      streams,
    });
  } catch (err) {
    console.error('[API:Streams] Error resolving streams:', err);
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
