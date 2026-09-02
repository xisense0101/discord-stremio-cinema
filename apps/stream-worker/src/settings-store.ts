import fs from 'fs';
import path from 'path';

const SETTINGS_FILE = path.resolve(process.cwd(), 'data/user_settings.json');

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
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const merged = { ...getStoredSettings(), ...updates };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  } catch (err) {
    console.warn('[SettingsStore] Write notice:', (err as Error).message);
    return { ...getStoredSettings(), ...updates };
  }
}
