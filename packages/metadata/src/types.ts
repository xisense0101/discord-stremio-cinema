export interface MediaItem {
  id: string;
  imdbId: string;
  type: 'movie' | 'series';
  name: string;
  releaseInfo?: string;
  poster?: string;
  background?: string;
  description?: string;
  genres?: string[];
  cast?: string[];
  rating?: string;
  runtime?: string;
}

export interface MediaStream {
  id: string;
  title: string;
  name: string;
  quality: '1080p' | '720p' | '4k' | '480p' | 'other';
  resolution?: string;
  codec?: string;
  audio?: string;
  url: string;
  infoHash?: string;
  fileIdx?: number;
  isCached: boolean;
  provider: string;
  details?: string;
  sizeBytes?: number;
}

export interface SubtitleTrackInfo {
  id: string;
  lang: string;
  url?: string;
  format?: string;
  isEmbedded?: boolean;
  streamIndex?: number;
  codec?: string;
  /**
   * Frame rate the subtitle was timed against, from OpenSubtitles' fpsMilli.
   * Decisive for sync: a 25fps subtitle over a 23.976fps source drifts by
   * 4.3%, roughly five minutes across a two hour film, and no constant delay
   * can correct that.
   */
  fps?: number;
  /** Release the subtitle was timed for, used to match it to the file playing. */
  releaseName?: string;
  fileName?: string;
}

export interface AudioTrackInfo {
  id: string;
  audioStreamIndex: number;
  rawStreamIndex: number;
  language: string;
  rawLanguage: string;
  label: string;
  codec: string;
  channels: number;
  channelLayout: string;
  title?: string;
  /** True when the container's own metadata (ffprobe disposition.default) flags this as the default track */
  isDefault: boolean;
}
