import { NextRequest, NextResponse } from 'next/server';
import { resolveMediaStreams } from '@discord-stremio/metadata';
import { DEFAULT_GUILD_ID, WORKER_URL, workerAuthHeaders } from '@/lib/worker-client';
import { getStoredSettings } from '@/lib/settings-store';

export const dynamic = 'force-dynamic';

/**
 * The queue is owned by the stream-worker, not by this app.
 *
 * It used to be held by @discord-stremio/queue, which stores through a `kv`
 * helper that silently falls back to a per-process in-memory Map whenever
 * Redis is not connected - and it never was, because nothing in the codebase
 * ever opened a Redis connection. This app runs as serverless functions, so
 * each instance had its own Map: adding movies wrote to whichever instance
 * handled that request and a later refresh read from whichever handled that
 * one, which is why a queue of five movies appeared on some refreshes and was
 * empty on others. The worker meanwhile had its own separate, permanently
 * empty copy, so when a movie ended it saw an empty queue and stopped instead
 * of moving on to the next title.
 */
async function workerQueue(method: string, guildId: string, payload?: unknown) {
  const url = `${WORKER_URL}/api/queue?guildId=${encodeURIComponent(guildId)}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...workerAuthHeaders() },
    body: payload ? JSON.stringify({ ...(payload as object), guildId }) : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`Worker queue request failed (HTTP ${res.status})`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
  const guildId = req.nextUrl.searchParams.get('guildId') || DEFAULT_GUILD_ID;
  try {
    const data = await workerQueue('GET', guildId);
    return NextResponse.json({ items: data.items || [] });
  } catch (err) {
    // Surface the failure instead of returning an empty list, so the UI can
    // say "couldn't reach the worker" rather than silently showing an empty
    // queue that looks like the entries were lost.
    return NextResponse.json(
      { items: [], error: (err as Error).message },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const {
      mediaItem,
      stream,
      quality,
      requestedBy = 'senzu (Web)',
      guildId = DEFAULT_GUILD_ID,
      insertIndex,
    } = await req.json();

    if (!mediaItem || !mediaItem.imdbId) {
      return NextResponse.json({ success: false, error: 'Valid mediaItem with imdbId required' }, { status: 400 });
    }

    const settings = await getStoredSettings();
    const targetQuality = quality || settings.defaultQuality || '720p';

    // Resolving here is best-effort and only powers the release/quality label
    // shown in the queue UI. The worker re-resolves from the imdbId at play
    // time regardless - it has to, because debrid links are IP-locked to the
    // resolver and expire - so a resolution hiccup must not block queueing a
    // movie, which is what the old hard 404 did.
    let selectedStream = stream;
    if (!selectedStream) {
      try {
        const streams = await resolveMediaStreams(mediaItem.type || 'movie', mediaItem.imdbId, undefined, undefined, targetQuality);
        selectedStream = streams?.[0];
      } catch {
        selectedStream = undefined;
      }
    }

    const item = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      guildId,
      media: mediaItem,
      stream: selectedStream,
      requestedBy,
      addedAt: Date.now(),
    };

    const data = await workerQueue('POST', guildId, { item, insertIndex });
    return NextResponse.json({ success: true, size: data.size, item, items: data.items });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { index, clearAll, guildId = DEFAULT_GUILD_ID } = await req.json();

    if (clearAll) {
      await workerQueue('DELETE', guildId, { clearAll: true });
      return NextResponse.json({ success: true, message: 'Queue cleared' });
    }

    if (index !== undefined) {
      const data = await workerQueue('DELETE', guildId, { index: Number(index) });
      return NextResponse.json({ success: true, removed: data.removed, items: data.items });
    }

    return NextResponse.json({ success: false, error: 'Provide index or clearAll' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const {
      fromIndex,
      toIndex,
      index,
      quality,
      mediaItem,
      guildId = DEFAULT_GUILD_ID,
    } = await req.json();

    // Reorder
    if (fromIndex !== undefined && toIndex !== undefined) {
      const data = await workerQueue('PATCH', guildId, {
        fromIndex: Number(fromIndex),
        toIndex: Number(toIndex),
      });
      return NextResponse.json({ success: true, items: data.items });
    }

    // Replace the movie at index
    if (index !== undefined && mediaItem && mediaItem.imdbId) {
      const settings = await getStoredSettings();
      const targetQuality = quality || settings.defaultQuality || '720p';
      let replacementStream;
      try {
        const streams = await resolveMediaStreams(mediaItem.type || 'movie', mediaItem.imdbId, undefined, undefined, targetQuality);
        replacementStream = streams?.[0];
      } catch {
        replacementStream = undefined;
      }

      const data = await workerQueue('PATCH', guildId, {
        index: Number(index),
        updates: { media: mediaItem, stream: replacementStream },
      });
      return NextResponse.json({ success: true, updated: data.updated, items: data.items });
    }

    // Change the preferred quality of the movie at index
    if (index !== undefined && quality) {
      const current = await workerQueue('GET', guildId);
      const currentItem = (current.items || [])[Number(index)];
      if (!currentItem) {
        return NextResponse.json({ success: false, error: 'Queue item not found' }, { status: 404 });
      }

      let requalifiedStream;
      try {
        const streams = await resolveMediaStreams('movie', currentItem.media.imdbId, undefined, undefined, quality);
        requalifiedStream = streams?.[0];
      } catch {
        requalifiedStream = undefined;
      }

      const data = await workerQueue('PATCH', guildId, {
        index: Number(index),
        // Preserve the requested tier even when resolution failed, so the
        // worker still targets it when it re-resolves at play time.
        updates: { stream: requalifiedStream || { ...currentItem.stream, quality } },
      });
      return NextResponse.json({ success: true, updated: data.updated, items: data.items });
    }

    return NextResponse.json({ success: false, error: 'Invalid patch payload' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
