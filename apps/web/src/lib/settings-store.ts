import { WORKER_URL, DEFAULT_GUILD_ID, DEFAULT_VOICE_CHANNEL_ID, workerAuthHeaders } from './worker-client';

export interface UserSettings {
  userId: string;
  autoFollow: boolean;
  selectedGuildId: string;
  selectedVoiceChannelId: string;
  defaultQuality: string;
  autoEnglishSubs: boolean;
  intermissionSeconds: number;
}

const DEFAULT_SETTINGS: UserSettings = {
  userId: '',
  autoFollow: false,
  selectedGuildId: DEFAULT_GUILD_ID,
  selectedVoiceChannelId: DEFAULT_VOICE_CHANNEL_ID,
  defaultQuality: '720p',
  autoEnglishSubs: true,
  intermissionSeconds: 120,
};

/**
 * Settings are persisted on the stream-worker - a long-running process with
 * real durable disk - not in this Next.js app's own filesystem. This app
 * typically runs as ephemeral serverless functions (e.g. on Vercel) with no
 * durable/shared filesystem: fs.writeFileSync here would silently fail to
 * survive between invocations. That's what made manually selecting a voice
 * channel appear to "revert" back to the default guild/VC a couple of
 * seconds later - the UI's 2s settings poll would read back the
 * never-actually-persisted default on the next (likely different)
 * serverless invocation, and then playing a movie would use that stale
 * default instead of the channel you actually joined.
 */
export async function getStoredSettings(): Promise<UserSettings> {
  try {
    const res = await fetch(`${WORKER_URL}/api/settings`, {
      headers: workerAuthHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ...DEFAULT_SETTINGS };
    const data = await res.json();
    return { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  } catch (err) {
    console.warn('[SettingsStore] Fetch notice:', (err as Error).message);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveStoredSettings(updates: Partial<UserSettings>): Promise<UserSettings> {
  try {
    const res = await fetch(`${WORKER_URL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...workerAuthHeaders() },
      body: JSON.stringify(updates),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ...DEFAULT_SETTINGS, ...updates };
    const data = await res.json();
    return { ...DEFAULT_SETTINGS, ...(data.settings || updates) };
  } catch (err) {
    console.warn('[SettingsStore] Save notice:', (err as Error).message);
    return { ...DEFAULT_SETTINGS, ...updates };
  }
}
