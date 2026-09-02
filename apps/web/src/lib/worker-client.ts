import config from '@discord-stremio/config';

export const WORKER_URL = process.env.WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL || 'http://127.0.0.1:4001';
export const DEFAULT_GUILD_ID = process.env.DEFAULT_GUILD_ID || '1543532988229488680';
export const DEFAULT_VOICE_CHANNEL_ID = process.env.DEFAULT_VOICE_CHANNEL_ID || '1543532988795461666';

export interface CommandResult {
  success: boolean;
  state?: any;
  error?: string;
}

export async function sendWorkerCommand(
  action: string,
  payload: any = {},
  guildId: string = DEFAULT_GUILD_ID,
  voiceChannelId: string = DEFAULT_VOICE_CHANNEL_ID
): Promise<CommandResult> {
  try {
    const res = await fetch(`${WORKER_URL}/ipc/command`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.server.workerIpcSecret ? { 'x-worker-secret': config.server.workerIpcSecret } : {}),
      },
      body: JSON.stringify({
        id: `web_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        action,
        guildId,
        voiceChannelId,
        payload,
        timestamp: Date.now(),
      }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Worker error ${res.status}: ${text}` };
    }

    const data = await res.json();
    return data;
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
