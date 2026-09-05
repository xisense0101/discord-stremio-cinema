import fs from 'fs';
import path from 'path';

/**
 * Absolute directory for the worker's durable state (settings, queue).
 *
 * This must NOT be derived from process.cwd(). pnpm runs the workspace script
 * from the package directory, so cwd is /app/apps/stream-worker inside the
 * container - a path that lives in the image's writable layer and is
 * destroyed on every redeploy. The compose file mounts the host's
 * /opt/streamer/data at /app/data, and that is the only location that
 * survives a container being replaced. Verified live: a queue written
 * relative to cwd landed in /app/apps/stream-worker/data while the mounted
 * /app/data sat empty.
 */
export const DATA_DIR = process.env.WORKER_DATA_DIR || path.resolve(process.cwd(), 'data');

export function dataFile(name: string): string {
  return path.join(DATA_DIR, name);
}

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}
