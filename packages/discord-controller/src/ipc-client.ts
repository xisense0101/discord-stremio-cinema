import { WorkerCommand, WorkerResponse, WorkerAction } from './types.js';
import { kv } from '@discord-stremio/sessions';
import config from '@discord-stremio/config';

export class IPCClient {
  /**
   * Dispatch playback action to the Stream Worker
   */
  async sendCommand(
    guildId: string,
    action: WorkerAction,
    payload?: any,
    voiceChannelId?: string,
    textChannelId?: string
  ): Promise<WorkerResponse> {
    const commandId = Math.random().toString(36).substring(2, 12);
    const cmd: WorkerCommand = {
      id: commandId,
      action,
      guildId,
      voiceChannelId,
      textChannelId,
      payload,
      timestamp: Date.now(),
    };

    // Primary path: Direct HTTP IPC to Worker REST endpoint with 30s timeout
    try {
      const workerUrl = `http://127.0.0.1:${config.server.workerPort}/ipc/command`;
      const res = await fetch(workerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.server.workerIpcSecret ? { 'x-worker-secret': config.server.workerIpcSecret } : {}),
        },
        body: JSON.stringify(cmd),
        signal: AbortSignal.timeout(30000),
      });

      if (res.ok) {
        return (await res.json()) as WorkerResponse;
      } else {
        const errJson = await res.json().catch(() => ({}));
        return {
          commandId,
          success: false,
          error: (errJson as any).error || `HTTP ${res.status}`,
        };
      }
    } catch (httpErr) {
      // Fallback: Publish via Redis Pub/Sub
      try {
        await kv.publish(`stremio:commands:${guildId}`, JSON.stringify(cmd));
        return { commandId, success: true };
      } catch (redisErr) {
        return {
          commandId,
          success: false,
          error: `Worker unreachable: ${(httpErr as Error).message}`,
        };
      }
    }
  }
}

export const ipcClient = new IPCClient();
