import { NextRequest, NextResponse } from 'next/server';
import {
  fetchMoviesCatalog,
  filterAndPickRandom,
  filterAndPickByDuration,
  parseRuntimeMinutes,
} from '@/lib/random-movie';
import { resolveMediaStreams } from '@discord-stremio/metadata';
import { QueueItem } from '@discord-stremio/queue';
import { DEFAULT_GUILD_ID, WORKER_URL, workerAuthHeaders } from '@/lib/worker-client';
import { getStoredSettings } from '@/lib/settings-store';

export const dynamic = 'force-dynamic';

/** The worker owns the queue - see apps/stream-worker/src/queue-store.ts. */
async function enqueueOnWorker(guildId: string, item: QueueItem): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/queue?guildId=${encodeURIComponent(guildId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...workerAuthHeaders() },
    body: JSON.stringify({ item, guildId }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Worker queue enqueue failed (HTTP ${res.status})`);
}

export async function GET(req: NextRequest) {
  try {
    const startYear = parseInt(req.nextUrl.searchParams.get('startYear') || '2015', 10);
    const endYear = parseInt(req.nextUrl.searchParams.get('endYear') || '2025', 10);
    const count = parseInt(req.nextUrl.searchParams.get('count') || '0', 10);
    const days = parseInt(req.nextUrl.searchParams.get('days') || '0', 10);
    const hours = parseInt(req.nextUrl.searchParams.get('hours') || '0', 10);
    const genre = req.nextUrl.searchParams.get('genre') || 'all';
    const minRating = parseFloat(req.nextUrl.searchParams.get('minRating') || '6.0');

    const movies = await fetchMoviesCatalog(genre);

    let picked: any[] = [];
    let estimatedMinutes = 0;

    const totalTargetMinutes = (days * 24 + hours) * 60;

    if (totalTargetMinutes > 0) {
      const result = filterAndPickByDuration(movies, startYear, endYear, totalTargetMinutes, minRating);
      picked = result.picked;
      estimatedMinutes = result.totalMinutes;
    } else {
      const targetCount = count > 0 ? count : 3;
      picked = filterAndPickRandom(movies, startYear, endYear, targetCount, minRating);
      estimatedMinutes = picked.reduce((acc, m) => acc + parseRuntimeMinutes(m.runtime) + 2, 0);
    }

    return NextResponse.json({
      success: true,
      totalCatalog: movies.length,
      picked,
      estimatedMinutes,
      filters: { startYear, endYear, count, days, hours, genre, minRating },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const {
      startYear = 2015,
      endYear = 2025,
      count = 0,
      days = 0,
      hours = 0,
      genre = 'all',
      minRating = 6.5,
      quality,
      guildId = DEFAULT_GUILD_ID,
      requestedBy = 'senzu (Smart Marathon Binge)',
    } = await req.json();

    const settings = await getStoredSettings();
    const targetQuality = quality || settings.defaultQuality || '1080p';

    const movies = await fetchMoviesCatalog(genre);

    let picked: any[] = [];
    const totalTargetMinutes = (days * 24 + hours) * 60;

    if (totalTargetMinutes > 0) {
      const result = filterAndPickByDuration(movies, startYear, endYear, totalTargetMinutes, minRating);
      picked = result.picked;
    } else {
      const targetCount = count > 0 ? count : 3;
      picked = filterAndPickRandom(movies, startYear, endYear, targetCount, minRating);
    }

    if (picked.length === 0) {
      return NextResponse.json({
        success: false,
        error: `No popular movies found between ${startYear}-${endYear} with rating >= ${minRating}`,
      }, { status: 404 });
    }

    const queuedItems: QueueItem[] = [];
    let totalScheduledMins = 0;

    // Resolve streams and queue each picked movie matching target quality.
    // Resolution is best-effort - the worker re-resolves from the imdbId when
    // it actually plays the item - so a movie is still queued if its stream
    // lookup fails here, rather than being silently dropped from the marathon.
    for (const movie of picked) {
      let selectedStream;
      try {
        const streams = await resolveMediaStreams('movie', movie.imdbId, undefined, undefined, targetQuality);
        selectedStream = streams?.[0];
      } catch {
        selectedStream = undefined;
      }

      const item: QueueItem = {
        id: `queue_rand_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        guildId,
        media: movie,
        stream: selectedStream,
        requestedBy,
        addedAt: Date.now(),
      };
      await enqueueOnWorker(guildId, item);
      queuedItems.push(item);
      totalScheduledMins += parseRuntimeMinutes(movie.runtime) + 2;
    }

    const schedHours = Math.floor(totalScheduledMins / 60);
    const schedMins = totalScheduledMins % 60;

    return NextResponse.json({
      success: true,
      queuedCount: queuedItems.length,
      totalScheduledMinutes: totalScheduledMins,
      formattedDuration: `${schedHours}h ${schedMins}m`,
      items: queuedItems,
      message: `🎉 Successfully queued ${queuedItems.length} movies (~${schedHours}h ${schedMins}m marathon, ${targetQuality})!`,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
