import http from 'http';
import config from '@discord-stremio/config';
import { botController } from './bot.js';
import { getSystemMetrics } from '@discord-stremio/diagnostics';

async function bootstrap(): Promise<void> {
  console.log('====================================================');
  console.log('🎮 Starting Discord Stremio Player Controller Bot...');
  console.log('====================================================');

  // Start Health & Status HTTP Server (Section 59)
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && (req.url === '/health' || req.url === '/ready')) {
      const ready = botController.isReady();
      res.writeHead(ready ? 200 : 503);
      res.end(
        JSON.stringify({
          status: ready ? 'healthy' : 'initializing',
          controller: ready,
          metrics: getSystemMetrics(),
        })
      );
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(config.server.port, '0.0.0.0', () => {
    console.log(`[Health Server] Listening on http://0.0.0.0:${config.server.port}`);
  });

  // Start Discord Bot
  await botController.start();

  const shutdown = async (signal: string) => {
    console.log(`[Controller] Received ${signal}, shutting down...`);
    await botController.stop();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Controller] Fatal startup error:', err);
  process.exit(1);
});
