export interface GuildSession {
  sessionId: string;
  guildId: string;
  voiceChannelId: string;
  textChannelId?: string;
  mediaId?: string;
  mediaTitle?: string;
  quality?: string;
  streamUrl?: string;
  status: 'IDLE' | 'BUFFERING' | 'PLAYING' | 'PAUSED' | 'ENDED' | 'ERROR';
  currentTime: number;
  duration: number;
  activeSubtitle?: string;
  activeAudio?: string;
  createdAt: number;
  updatedAt: number;
}
