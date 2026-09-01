import fs from 'fs';
import path from 'path';
import { DEFAULT_GUILD_ID, DEFAULT_VOICE_CHANNEL_ID } from './worker-client';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SETTINGS_FILE = path.resolve(DATA_DIR, 'user_settings.json');

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
  defaultQuality: '1080p',
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
  } catch (err) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveStoredSettings(updates: Partial<UserSettings>): UserSettings {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const current = getStoredSettings();
    const merged = { ...current, ...updates };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch (err) {
    console.warn('[SettingsStore] Write notice:', (err as Error).message);
    return { ...DEFAULT_SETTINGS, ...updates };
  }
}
