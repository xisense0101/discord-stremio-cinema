import { Redis } from 'ioredis';
import config from '@discord-stremio/config';

let redisInstance: Redis | null = null;
let isRedisConnected = false;

// In-memory key-value fallback store
const memoryStore = new Map<string, string>();
const memorySubscribers = new Map<string, Array<(channel: string, message: string) => void>>();

export function getRedisClient(): Redis | null {
  if (redisInstance) return redisInstance;

  try {
    const client = new Redis(config.redis.url, {
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 3) {
          console.warn('[Redis] Connection failed, using in-memory store.');
          return null;
        }
        return Math.min(times * 100, 1000);
      },
      lazyConnect: true,
    });

    client.on('connect', () => {
      isRedisConnected = true;
      console.log('[Redis] Connected successfully.');
    });

    client.on('error', (err) => {
      isRedisConnected = false;
      // Silent in-memory fallback warning
    });

    client.connect().catch(() => {
      // Handled in retryStrategy
    });

    redisInstance = client;
    return client;
  } catch (err) {
    console.warn('[Redis] Client initialization error, falling back to memory.');
    return null;
  }
}

export const kv = {
  async get(key: string): Promise<string | null> {
    if (isRedisConnected && redisInstance) {
      try {
        return await redisInstance.get(key);
      } catch {
        return memoryStore.get(key) || null;
      }
    }
    return memoryStore.get(key) || null;
  },

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (isRedisConnected && redisInstance) {
      try {
        if (ttlSeconds) {
          await redisInstance.set(key, value, 'EX', ttlSeconds);
        } else {
          await redisInstance.set(key, value);
        }
        return;
      } catch {
        // Fallback to memory
      }
    }
    memoryStore.set(key, value);
    if (ttlSeconds) {
      setTimeout(() => memoryStore.delete(key), ttlSeconds * 1000);
    }
  },

  async del(key: string): Promise<void> {
    if (isRedisConnected && redisInstance) {
      try {
        await redisInstance.del(key);
        return;
      } catch {
        // Fallback
      }
    }
    memoryStore.delete(key);
  },

  async acquireLock(key: string, ttlMs: number = 5000): Promise<boolean> {
    const lockKey = `lock:${key}`;
    if (isRedisConnected && redisInstance) {
      try {
        const res = await redisInstance.set(lockKey, 'locked', 'PX', ttlMs, 'NX');
        return res === 'OK';
      } catch {
        // Fallback
      }
    }
    if (memoryStore.has(lockKey)) return false;
    memoryStore.set(lockKey, 'locked');
    setTimeout(() => memoryStore.delete(lockKey), ttlMs);
    return true;
  },

  async releaseLock(key: string): Promise<void> {
    const lockKey = `lock:${key}`;
    await this.del(lockKey);
  },

  async publish(channel: string, message: string): Promise<void> {
    if (isRedisConnected && redisInstance) {
      try {
        await redisInstance.publish(channel, message);
        return;
      } catch {
        // Fallback
      }
    }
    const handlers = memorySubscribers.get(channel);
    if (handlers) {
      handlers.forEach((fn) => fn(channel, message));
    }
  },

  subscribe(channel: string, callback: (channel: string, message: string) => void): void {
    if (!memorySubscribers.has(channel)) {
      memorySubscribers.set(channel, []);
    }
    memorySubscribers.get(channel)!.push(callback);

    if (isRedisConnected && redisInstance) {
      const sub = redisInstance.duplicate();
      sub.subscribe(channel, (err) => {
        if (!err) {
          sub.on('message', (chan, msg) => callback(chan, msg));
        }
      });
    }
  },
};
