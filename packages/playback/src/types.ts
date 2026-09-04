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
  /** The actual torrent/release title of the source file currently playing */
  sourceRelease?: string;
  /** The actual quality tag of the source file (may differ from the requested `resolution` if no exact-tier candidate was reachable) */
  sourceQuality?: string;
  sourceSizeBytes?: number;
  /** True when no candidate matching the requested quality tier was reachable, and playback fell back to a different tier */
  qualityMismatch?: boolean;
}

export interface PlaybackOptions {
  url: string;
  title: string;
  imdbId?: string;
  initialTime?: number;
  subtitles?: Array<{ label: string; language: string; url: string }>;
}
