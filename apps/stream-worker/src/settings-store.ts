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

export function getStoredSettings(): UserSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS };
    }
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveStoredSettings(updates: Partial<UserSettings>): UserSettings {
  try {
    ensureDataDir();
    const merged = { ...getStoredSettings(), ...updates };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch (err) {
    console.warn('[SettingsStore] Write notice:', (err as Error).message);
    return { ...getStoredSettings(), ...updates };
  }
}
