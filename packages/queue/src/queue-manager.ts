import { QueueItem } from './types.js';
import { kv } from '@discord-stremio/sessions';

export class QueueManager {
  private keyPrefix = 'stremio:queue:';

  private async getQueueRaw(guildId: string): Promise<QueueItem[]> {
    const raw = await kv.get(`${this.keyPrefix}${guildId}`);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as QueueItem[];
    } catch {
      return [];
    }
  }

  private async saveQueueRaw(guildId: string, items: QueueItem[]): Promise<void> {
    await kv.set(`${this.keyPrefix}${guildId}`, JSON.stringify(items), 86400 * 7);
  }

  async enqueue(guildId: string, item: QueueItem): Promise<number> {
    const queue = await this.getQueueRaw(guildId);
    queue.push(item);
    await this.saveQueueRaw(guildId, queue);
    return queue.length;
  }

  async dequeue(guildId: string): Promise<QueueItem | null> {
    const queue = await this.getQueueRaw(guildId);
    if (queue.length === 0) return null;
    const nextItem = queue.shift()!;
    await this.saveQueueRaw(guildId, queue);
    return nextItem;
  }

  async peek(guildId: string): Promise<QueueItem | null> {
    const queue = await this.getQueueRaw(guildId);
    return queue.length > 0 ? queue[0] : null;
  }

  async list(guildId: string): Promise<QueueItem[]> {
    return this.getQueueRaw(guildId);
  }

  async remove(guildId: string, index: number): Promise<QueueItem | null> {
    const queue = await this.getQueueRaw(guildId);
    if (index < 0 || index >= queue.length) return null;
    const removed = queue.splice(index, 1)[0];
    await this.saveQueueRaw(guildId, queue);
    return removed;
  }

  async reorder(guildId: string, fromIndex: number, toIndex: number): Promise<QueueItem[]> {
    const queue = await this.getQueueRaw(guildId);
    if (fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length) {
      return queue;
    }
    const [moved] = queue.splice(fromIndex, 1);
    queue.splice(toIndex, 0, moved);
    await this.saveQueueRaw(guildId, queue);
    return queue;
  }

  async update(guildId: string, index: number, updates: Partial<QueueItem>): Promise<QueueItem | null> {
    const queue = await this.getQueueRaw(guildId);
    if (index < 0 || index >= queue.length) return null;
    queue[index] = { ...queue[index], ...updates };
    await this.saveQueueRaw(guildId, queue);
    return queue[index];
  }

  async insert(guildId: string, index: number, item: QueueItem): Promise<QueueItem[]> {
    const queue = await this.getQueueRaw(guildId);
    const targetIdx = Math.max(0, Math.min(queue.length, index));
    queue.splice(targetIdx, 0, item);
    await this.saveQueueRaw(guildId, queue);
    return queue;
  }

  async clear(guildId: string): Promise<void> {
    await kv.del(`${this.keyPrefix}${guildId}`);
  }

  async size(guildId: string): Promise<number> {
    const queue = await this.getQueueRaw(guildId);
    return queue.length;
  }
}

export const queueManager = new QueueManager();
