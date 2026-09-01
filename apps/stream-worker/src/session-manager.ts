import { WorkerGuildSession } from './session.js';
import { Streamer } from '@dank074/discord-video-stream';

export class SessionManager {
  private sessions: Map<string, WorkerGuildSession> = new Map();
  public readonly streamer: Streamer;

  constructor(streamer: Streamer) {
    this.streamer = streamer;
  }

  getOrCreateSession(guildId: string): WorkerGuildSession {
    let session = this.sessions.get(guildId);
    if (!session) {
      session = new WorkerGuildSession(guildId, this.streamer);
      this.sessions.set(guildId, session);
    }
    return session;
  }

  getSession(guildId: string): WorkerGuildSession | undefined {
    return this.sessions.get(guildId);
  }

  async stopSession(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);
    if (session) {
      await session.stop();
      this.sessions.delete(guildId);
    }
  }

  async stopAll(): Promise<void> {
    for (const [guildId, session] of this.sessions.entries()) {
      try {
        await session.stop();
      } catch (err) {
        console.warn(`[SessionManager] Error stopping session ${guildId}:`, err);
      }
    }
    this.sessions.clear();
  }

  getActiveCount(): number {
    return this.sessions.size;
  }
}
