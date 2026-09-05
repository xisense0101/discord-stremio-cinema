import fs from 'fs';
import { dataFile, ensureDataDir } from './data-dir.js';

// Absolute, mount-aware path - see data-dir.ts. This previously resolved
// against process.cwd(), which put settings in the container's writable layer
// instead of the mounted volume, so they were silently discarded on redeploy.
const SETTINGS_FILE = dataFile('user_settings.json');

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
  selectedGuildId: '',
  selectedVoiceChannelId: '',
  defaultQuality: '720p',
  autoEnglishSubs: true,
  intermissionSeconds: 120,
};

/**
 * Cached in memory after the first read, with writes going through to disk.
 * Same reasoning as the queue store: this process packetizes video on the one
 * Node thread, so synchronous file reads on every request land in the path
 * that sends RTP packets. This process is the only writer.
 */
let cache: UserSettings | null = null;

export function getStoredSettings(): UserSettings {
  if (cache) return cache;
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      const defaults: UserSettings = { ...DEFAULT_SETTINGS };
      cache = defaults;
      return defaults;
    }
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const merged: UserSettings = { ...DEFAULT_SETTINGS, ...parsed };
    cache = merged;
    return merged;
  } catch {
    const defaults: UserSettings = { ...DEFAULT_SETTINGS };
    cache = defaults;
    return defaults;
  }
}

export function saveStoredSettings(updates: Partial<UserSettings>): UserSettings {
  try {
    ensureDataDir();
    const merged = { ...getStoredSettings(), ...updates };
    cache = merged;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch (err) {
    console.warn('[SettingsStore] Write notice:', (err as Error).message);
    return { ...getStoredSettings(), ...updates };
  }
}
