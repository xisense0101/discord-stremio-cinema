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
}
