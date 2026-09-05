import fs from 'fs';
import path from 'path';

const QUEUE_FILE = path.resolve(process.cwd(), 'data/queue.json');

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
function readAll(): QueueMap {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as QueueMap) : {};
  } catch (err) {
    console.warn('[QueueStore] Read notice:', (err as Error).message);
    return {};
  }
}

function writeAll(map: QueueMap): void {
  try {
    const dir = path.dirname(QUEUE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

export function enqueue(guildId: string, item: StoredQueueItem): StoredQueueItem[] {
  const map = readAll();
  const items = map[guildId] || [];
  items.push(item);
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
