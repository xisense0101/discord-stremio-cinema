import fs from 'fs';
import path from 'path';
import { dataFile, ensureDataDir } from './data-dir.js';

const QUEUE_FILE = dataFile('queue.json');

export interface StoredQueueItem {
  id: string;
  guildId: string;
  media: {
    imdbId: string;
    name: string;
    type?: string;
    poster?: string;
    year?: string;
    [key: string]: unknown;
  };
  /**
   * Optional. The worker re-resolves the playable URL from imdbId at play time
   * anyway (debrid links are IP-locked to whoever resolved them and expire), so
   * a queue entry without one is still perfectly playable - this is only kept
   * for showing the release/quality in the UI before playback starts.
   */
  stream?: { url?: string; quality?: string; title?: string; [key: string]: unknown };
  requestedBy?: string;
  addedAt: number;
}

type QueueMap = Record<string, StoredQueueItem[]>;

/**
 * The queue lives here, on the stream-worker, because this is the only
 * component that is both long-lived and singular.
 *
 * It used to live in @discord-stremio/queue, which stores through a `kv`
 * helper that falls back to a plain in-process Map whenever Redis is not
 * connected - and Redis was never actually connected anywhere, because
 * nothing in the codebase ever called getRedisClient(). So every process kept
 * its own private queue in memory:
 *
 *   - The Next.js app runs as serverless functions, one Map per instance.
 *     Adding five movies wrote to whichever instance served that request, and
 *     a later refresh read from whichever instance served *that* one - which
 *     is why the queue appeared and disappeared between refreshes.
 *   - The worker had its own separate, always-empty Map, so when a movie
 *     finished, handleMediaFinished() asked for the queue size, got 0, and
 *     ended playback instead of starting an intermission and playing the next
 *     title.
 *
 * Both symptoms were the same bug: no shared source of truth. Everything now
 * reads and writes this one file, which sits on the container's mounted data
 * volume and so also survives worker restarts and redeploys.
 */
/**
 * The file is read once and then served from memory, with every write going
 * through to disk.
 *
 * This process is also packetizing video, and all of that runs on the one
 * Node thread - measured at ~97% of a core while streaming. readFileSync plus
 * JSON.parse of a ~20KB queue on every request therefore lands directly in
 * the path that sends RTP packets, and the web UI polls player state every
 * two seconds. This process is the only writer, so a cache cannot go stale.
 */
let cache: QueueMap | null = null;

function readAll(): QueueMap {
  if (cache) return cache;
  try {
    if (!fs.existsSync(QUEUE_FILE)) {
      cache = {};
      return cache;
    }
    const parsed = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    cache = parsed && typeof parsed === 'object' ? (parsed as QueueMap) : {};
    return cache;
  } catch (err) {
    console.warn('[QueueStore] Read notice:', (err as Error).message);
    cache = {};
    return cache;
  }
}

function writeAll(map: QueueMap): void {
  cache = map;
  try {
    ensureDataDir();
    // Write-then-rename so a crash mid-write can never leave a truncated file
    // that would read back as an empty queue.
    const tmp = `${QUEUE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf8');
    fs.renameSync(tmp, QUEUE_FILE);
  } catch (err) {
    console.warn('[QueueStore] Write notice:', (err as Error).message);
  }
}

export function listQueue(guildId: string): StoredQueueItem[] {
  return readAll()[guildId] || [];
}

export function queueSize(guildId: string): number {
  return listQueue(guildId).length;
}

/**
 * Adds an item unless the same title is already queued. Re-running a Smart
 * Marathon otherwise stacked the same films over and over - one real queue
 * had Avengers: Endgame three times and Insidious three times - because each
 * run picks from the same popularity-ranked catalogue.
 */
export function enqueue(guildId: string, item: StoredQueueItem): StoredQueueItem[] {
  const map = readAll();
  const items = map[guildId] || [];
  if (!items.some((existing) => existing.media?.imdbId === item.media?.imdbId)) {
    items.push(item);
  }
  map[guildId] = items;
  writeAll(map);
  return items;
}

/** Appends many items under a single read/write, skipping duplicates. */
export function enqueueMany(guildId: string, newItems: StoredQueueItem[]): StoredQueueItem[] {
  const map = readAll();
  const items = map[guildId] || [];
  const seen = new Set(items.map((i) => i.media?.imdbId).filter(Boolean));
  for (const item of newItems) {
    const id = item.media?.imdbId;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    items.push(item);
  }
  map[guildId] = items;
  writeAll(map);
  return items;
}

export function insertAt(guildId: string, index: number, item: StoredQueueItem): StoredQueueItem[] {
  const map = readAll();
  const items = map[guildId] || [];
  items.splice(Math.max(0, Math.min(items.length, index)), 0, item);
  map[guildId] = items;
  writeAll(map);
  return items;
}

export function dequeue(guildId: string): StoredQueueItem | null {
  const map = readAll();
  const items = map[guildId] || [];
  if (items.length === 0) return null;
  const next = items.shift()!;
  map[guildId] = items;
  writeAll(map);
  return next;
}

export function removeAt(guildId: string, index: number): StoredQueueItem | null {
  const map = readAll();
  const items = map[guildId] || [];
  if (index < 0 || index >= items.length) return null;
  const [removed] = items.splice(index, 1);
  map[guildId] = items;
  writeAll(map);
  return removed;
}

export function reorder(guildId: string, fromIndex: number, toIndex: number): StoredQueueItem[] {
  const map = readAll();
  const items = map[guildId] || [];
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) {
    return items;
  }
  const [moved] = items.splice(fromIndex, 1);
  items.splice(toIndex, 0, moved);
  map[guildId] = items;
  writeAll(map);
  return items;
}

export function updateAt(
  guildId: string,
  index: number,
  updates: Partial<StoredQueueItem>
): StoredQueueItem | null {
  const map = readAll();
  const items = map[guildId] || [];
  if (index < 0 || index >= items.length) return null;
  items[index] = { ...items[index], ...updates };
  map[guildId] = items;
  writeAll(map);
  return items[index];
}

export function clearQueue(guildId: string): void {
  const map = readAll();
  delete map[guildId];
  writeAll(map);
}
