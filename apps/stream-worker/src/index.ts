import { Client } from 'discord.js-selfbot-v13';
import { Streamer } from '@dank074/discord-video-stream';
import config from '@discord-stremio/config';
import { SessionManager } from './session-manager.js';
import { startIpcServer } from './ipc-server.js';
import { remuxServer } from './remux-server.js';
import { browserManager } from '@discord-stremio/playback';

async function bootstrap(): Promise<void> {
  console.log('====================================================');
  console.log('🚀 Starting Discord Stremio Go-Live Stream Worker...');
  console.log('====================================================');

  // Process-level crash resilience
  process.on('uncaughtException', (err: any) => {
    console.warn('[StreamWorker] Uncaught exception safely handled:', err?.message || err);
  });

  process.on('unhandledRejection', (reason: any) => {
    console.warn('[StreamWorker] Unhandled promise rejection safely handled:', reason?.message || reason);
  });

  // Start internal fMP4 zero-transcode remux server
  await remuxServer.start();

  const selfClient = new Client();
  const streamer = new Streamer(selfClient);

  const sessionManager = new SessionManager(streamer);

  // Start HTTP IPC Server
  startIpcServer(sessionManager);

  // Connect Self-Bot to Discord Voice Gateway
  selfClient.on('ready', () => {
    console.log(`[Streamer] Logged in to Discord as: ${selfClient.user?.tag} (${selfClient.user?.id})`);
  });

  try {
    console.log('[Streamer] Logging in Go-Live streaming client...');
    await streamer.client.login(config.discord.streamerToken);
  } catch (err) {
    console.error('[Streamer] Failed to login streamer account:', (err as Error).message);
    console.warn('[Streamer] Running in IPC listening mode.');
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    console.log(`[StreamWorker] Received ${signal}, terminating active sessions...`);
    await sessionManager.stopAll();
    await browserManager.closeAll();
    remuxServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[StreamWorker] Fatal startup error:', err);
  process.exit(1);
});
