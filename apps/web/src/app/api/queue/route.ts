import { NextRequest, NextResponse } from 'next/server';
import { queueManager, QueueItem } from '@discord-stremio/queue';
import { resolveMediaStreams } from '@discord-stremio/metadata';
import { DEFAULT_GUILD_ID } from '@/lib/worker-client';
import { getStoredSettings } from '@/lib/settings-store';

export async function GET(req: NextRequest) {
  const guildId = req.nextUrl.searchParams.get('guildId') || DEFAULT_GUILD_ID;
  const items = await queueManager.list(guildId);
  return NextResponse.json({ items });
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

    let selectedStream = stream;
    if (!selectedStream) {
      const streams = await resolveMediaStreams(mediaItem.type || 'movie', mediaItem.imdbId, undefined, undefined, targetQuality);
      if (!streams || streams.length === 0) {
        return NextResponse.json({ success: false, error: 'No cached TorBox stream found' }, { status: 404 });
      }
      selectedStream = streams[0];
    }

    const queueItem: QueueItem = {
      id: `queue_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      guildId,
      media: mediaItem,
      stream: selectedStream,
      requestedBy,
      addedAt: Date.now(),
    };

    if (insertIndex !== undefined && insertIndex >= 0) {
      const items = await queueManager.insert(guildId, Number(insertIndex), queueItem);
      return NextResponse.json({ success: true, size: items.length, item: queueItem, items });
    } else {
      const size = await queueManager.enqueue(guildId, queueItem);
      return NextResponse.json({ success: true, size, item: queueItem });
    }
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { index, clearAll, guildId = DEFAULT_GUILD_ID } = await req.json();

    if (clearAll) {
      await queueManager.clear(guildId);
      return NextResponse.json({ success: true, message: 'Queue cleared' });
    }

    if (index !== undefined) {
      const removed = await queueManager.remove(guildId, Number(index));
      return NextResponse.json({ success: true, removed });
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

    const settings = await getStoredSettings();

    // Reorder
    if (fromIndex !== undefined && toIndex !== undefined) {
      const items = await queueManager.reorder(guildId, Number(fromIndex), Number(toIndex));
      return NextResponse.json({ success: true, items });
    }

    // Replace movie at index
    if (index !== undefined && mediaItem && mediaItem.imdbId) {
      const targetQuality = quality || settings.defaultQuality || '1080p';
      const streams = await resolveMediaStreams(mediaItem.type || 'movie', mediaItem.imdbId, undefined, undefined, targetQuality);
      if (!streams || streams.length === 0) {
        return NextResponse.json({ success: false, error: 'No stream available for replacement movie' }, { status: 404 });
      }

      const updated = await queueManager.update(guildId, Number(index), {
        media: mediaItem,
        stream: streams[0],
      });
      return NextResponse.json({ success: true, updated });
    }

    // Change stream quality of movie at index
    if (index !== undefined && quality) {
      const queueList = await queueManager.list(guildId);
      const currentItem = queueList[Number(index)];
      if (!currentItem) {
        return NextResponse.json({ success: false, error: 'Queue item not found' }, { status: 404 });
      }

      const streams = await resolveMediaStreams('movie', currentItem.media.imdbId, undefined, undefined, quality);
      if (!streams || streams.length === 0) {
        return NextResponse.json({ success: false, error: `No cached ${quality} stream found` }, { status: 404 });
      }

      const updated = await queueManager.update(guildId, Number(index), {
        stream: streams[0],
      });
      return NextResponse.json({ success: true, updated });
    }

    return NextResponse.json({ success: false, error: 'Invalid patch payload' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
}
