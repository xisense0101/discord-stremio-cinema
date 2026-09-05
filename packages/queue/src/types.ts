import { MediaItem, MediaStream } from '@discord-stremio/metadata';

export interface QueueItem {
  id: string;
  guildId: string;
  media: MediaItem;
  /**
   * Optional. Debrid links are IP-locked to whoever resolved them and expire,
   * so the worker re-resolves from media.imdbId when it actually plays the
   * item. A stream stored here only drives the release/quality label shown in
   * the queue UI, which means a failed lookup at queue time must not stop the
   * title being queued.
   */
  stream?: MediaStream;
  requestedBy: {
    id: string;
    username: string;
  };
  addedAt: number;
}
