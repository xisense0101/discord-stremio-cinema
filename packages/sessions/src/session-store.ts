import { GuildSession } from './types.js';
import { kv } from './redis.js';

export class SessionStore {
  private keyPrefix = 'stremio:session:';

  async getSession(guildId: string): Promise<GuildSession | null> {
    const raw = await kv.get(`${this.keyPrefix}${guildId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as GuildSession;
    } catch {
      return null;
    }
  }

  async saveSession(session: GuildSession): Promise<void> {
    session.updatedAt = Date.now();
    await kv.set(`${this.keyPrefix}${session.guildId}`, JSON.stringify(session), 86400);
  }

  async deleteSession(guildId: string): Promise<void> {
    await kv.del(`${this.keyPrefix}${guildId}`);
  }

  async lockGuild(guildId: string, ttlMs: number = 6000): Promise<boolean> {
    return kv.acquireLock(`playback:${guildId}`, ttlMs);
  }

  async unlockGuild(guildId: string): Promise<void> {
    await kv.releaseLock(`playback:${guildId}`);
  }
}

export const sessionStore = new SessionStore();
