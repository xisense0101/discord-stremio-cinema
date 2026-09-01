export type WorkerAction =
  | 'OPEN_MEDIA'
  | 'PLAY'
  | 'PAUSE'
  | 'RESUME'
  | 'SEEK'
  | 'FORWARD'
  | 'REWIND'
  | 'SET_SUBTITLE'
  | 'SET_SUBTITLE_DELAY'
  | 'SET_QUALITY'
  | 'SET_AUDIO'
  | 'STOP'
  | 'GET_STATE';

export interface WorkerCommand {
  id: string;
  action: WorkerAction;
  guildId: string;
  voiceChannelId?: string;
  textChannelId?: string;
  payload?: any;
  timestamp: number;
}

export interface WorkerResponse {
  commandId: string;
  success: boolean;
  state?: any;
  error?: string;
}
