import { WorkerGuildSession } from './session.js';
import { Streamer } from '@dank074/discord-video-stream';

export class SessionManager {
  private sessions: Map<string, WorkerGuildSession> = new Map();
  public readonly streamer: Streamer;

  // The underlying Streamer wraps a single Discord account/voice connection,
  // so only one guild session can actually be "live" at a time. Track it so
  // we can cleanly tear down the previous session instead of letting its
  // ffmpeg process leak and keep burning CPU in the background.
  private activeGuildId: string | null = null;

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

  /**
   * Must be called before a session starts streaming. Stops (and fully
   * releases the ffmpeg process of) any other guild's session that still
   * thinks it's active, since they all share one Streamer/voice connection.
   */
  async claimActive(guildId: string): Promise<void> {
    if (this.activeGuildId && this.activeGuildId !== guildId) {
      const previous = this.sessions.get(this.activeGuildId);
      if (previous && previous.isStreaming) {
        console.warn(
          `[SessionManager] Guild ${guildId} is taking over the streamer from ${this.activeGuildId}; stopping previous session to avoid an orphaned ffmpeg process.`
        );
        try {
          await previous.stop();
        } catch (err) {
          console.warn(`[SessionManager] Error stopping previous session ${this.activeGuildId}:`, err);
        }
      }
    }
    this.activeGuildId = guildId;
  }

  clearActive(guildId: string): void {
    if (this.activeGuildId === guildId) {
      this.activeGuildId = null;
    }
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
    this.clearActive(guildId);
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
    this.activeGuildId = null;
  }

  getActiveCount(): number {
    return this.sessions.size;
  }
}
