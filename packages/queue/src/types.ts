import { MediaItem, MediaStream } from '@discord-stremio/metadata';

export interface QueueItem {
  id: string;
  guildId: string;
  media: MediaItem;
  stream: MediaStream;
  requestedBy: {
    id: string;
    username: string;
  };
  addedAt: number;
}
