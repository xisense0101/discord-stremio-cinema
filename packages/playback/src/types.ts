export type PlaybackStatus = 'IDLE' | 'BUFFERING' | 'PLAYING' | 'PAUSED' | 'ENDED' | 'ERROR' | 'INTERMISSION';

export interface SubtitleTrack {
  id: string;
  label: string;
  language: string;
  kind: string;
  active: boolean;
}

export interface AudioTrack {
  id: string;
  label: string;
  language: string;
  enabled: boolean;
}

export interface PlayerState {
  status: PlaybackStatus;
  title: string;
  currentTime: number;
  duration: number;
  bufferedTime: number;
  subtitles: SubtitleTrack[];
  activeSubtitle?: string;
  subtitleDelay?: number;
  intermissionRemaining?: number;
  audioTracks: AudioTrack[];
  activeAudio?: string;
  activeAudioTrack?: number;
  volume: number;
  muted: boolean;
  fps: number;
  resolution: string;
  stallCount: number;
  errorMessage?: string;
  updatedAt: number;
}

export interface PlaybackOptions {
  url: string;
  title: string;
  imdbId?: string;
  initialTime?: number;
  subtitles?: Array<{ label: string; language: string; url: string }>;
}
