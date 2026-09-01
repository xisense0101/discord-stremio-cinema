import http from 'http';
import { SessionManager } from './session-manager.js';
import { TokenManager } from './token-manager.js';
import { getSystemMetrics } from '@discord-stremio/diagnostics';
import config from '@discord-stremio/config';

export function startIpcServer(sessionManager: SessionManager): http.Server {
  const tokenManager = new TokenManager(sessionManager.streamer);

  async function safeJoinVoice(guildId: string, voiceChannelId: string): Promise<void> {
    try {
      const currentChannel = (sessionManager.streamer as any).voiceConnection?.channelId;
      if (currentChannel === voiceChannelId) {
        console.log(`[IPC] Streamer already in VC: ${voiceChannelId}`);
        return;
      }
      const joinPromise = sessionManager.streamer.joinVoice(guildId, voiceChannelId);
      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 3500));
      await Promise.race([joinPromise, timeoutPromise]);
    } catch (err) {
      console.warn('[IPC] joinVoice notice:', (err as Error).message);
    }
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    // Health check endpoint
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: 'healthy',
          worker: true,
          activeSessions: sessionManager.getActiveCount(),
          metrics: getSystemMetrics(),
        })
      );
      return;
    }

    // Token Health & Diagnostic endpoint
    if (req.method === 'GET' && req.url === '/api/token/health') {
      try {
        const health = await tokenManager.checkTokenHealth();
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, ...health }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // Token Update endpoint
    if (req.method === 'POST' && req.url === '/api/token/update') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const result = await tokenManager.updateTokens(payload);
          res.writeHead(result.success ? 200 : 400);
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ success: false, error: (err as Error).message }));
        }
      });
      return;
    }

    // List all guilds and voice channels available to the streamer bot
    if (req.method === 'GET' && req.url === '/api/discord/guilds') {
      try {
        const client = sessionManager.streamer.client;
        if (!client || !client.guilds || !client.guilds.cache) {
          res.writeHead(200);
          res.end(JSON.stringify({ success: false, error: 'Streamer bot is not logged in', guilds: [] }));
          return;
        }

        const guilds = client.guilds.cache.map((g) => {
          const voiceChannels = g.channels.cache
            .filter((c) => c.type === 'GUILD_VOICE' || c.type === 'GUILD_STAGE_VOICE' || (c as any).isVoice?.())
            .map((c) => ({
              id: c.id,
              name: c.name,
              type: c.type,
              userCount: (c as any).members?.size || 0,
            }));

          return {
            id: g.id,
            name: g.name,
            icon: g.iconURL?.(),
            voiceChannels,
          };
        });

        res.writeHead(200);
        res.end(JSON.stringify({ success: true, guilds }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: (err as Error).message, guilds: [] }));
      }
      return;
    }

    // Auto-detect which Voice Channel a User ID is currently sitting in
    if (req.method === 'GET' && req.url?.startsWith('/api/discord/user-vc')) {
      try {
        const urlObj = new URL(req.url, 'http://localhost');
        const userId = urlObj.searchParams.get('userId');
        if (!userId) {
          res.writeHead(400);
          res.end(JSON.stringify({ success: false, error: 'userId required' }));
          return;
        }

        const client = sessionManager.streamer.client;
        let foundVoiceState: any = null;

        if (client && client.guilds && client.guilds.cache) {
          for (const guild of client.guilds.cache.values()) {
            const vs = guild.voiceStates.cache.get(userId);
            if (vs && vs.channelId) {
              const ch = guild.channels.cache.get(vs.channelId);
              foundVoiceState = {
                guildId: guild.id,
                guildName: guild.name,
                voiceChannelId: vs.channelId,
                voiceChannelName: ch?.name || 'Voice Channel',
              };
              break;
            }
          }
        }

        res.writeHead(200);
        res.end(JSON.stringify({ success: !!foundVoiceState, voiceState: foundVoiceState }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, error: (err as Error).message }));
      }
      return;
    }

    // IPC Command endpoint
    if (req.method === 'POST' && req.url === '/ipc/command') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', async () => {
        try {
          const cmd = JSON.parse(body);
          const { id, action, guildId, voiceChannelId, textChannelId, payload } = cmd;

          console.log(`[IPC] Received action "${action}" for guild ${guildId}`);

          let state = null;
          const session = sessionManager.getOrCreateSession(guildId);

          switch (action) {
            case 'OPEN_MEDIA': {
              const streamUrl = payload?.streamUrl || payload?.stream?.url || '';
              const title = payload?.title || payload?.mediaItem?.name || 'Media';
              const imdbId = payload?.imdbId || payload?.mediaItem?.imdbId || payload?.mediaItem?.id;
              const type = payload?.type || payload?.mediaItem?.type || 'movie';
              const initialTime = payload?.initialTime || 0;
              const quality = payload?.quality || '1080p';
              const targetVc = voiceChannelId || payload?.voiceChannelId;

              state = await session.openMedia({
                streamUrl,
                title,
                imdbId,
                type,
                quality,
                voiceChannelId: targetVc,
                textChannelId,
                initialTime,
              });
              break;
            }

            case 'PAUSE': {
              await session.pause();
              state = await session.getState();
              break;
            }

            case 'RESUME': {
              await session.resume();
              state = await session.getState();
              break;
            }

            case 'SEEK': {
              await session.seek(payload?.seconds || 0);
              state = await session.getState();
              break;
            }

            case 'SET_SUBTITLE': {
              await session.setSubtitle(payload?.language || 'Off');
              state = await session.getState();
              break;
            }

            case 'SET_SUBTITLE_DELAY': {
              await session.setSubtitleDelay(payload?.delaySeconds || 0);
              state = await session.getState();
              break;
            }

            case 'SET_QUALITY': {
              await session.setQuality(payload?.quality || '1080p');
              state = await session.getState();
              break;
            }

            case 'SET_AUDIO': {
              await session.setAudio(payload?.trackId || '0');
              state = await session.getState();
              break;
            }

            case 'JOIN_VOICE':
            case 'SWITCH_VOICE_CHANNEL': {
              const targetGuildId = payload?.guildId || guildId;
              const targetVcId = payload?.voiceChannelId || voiceChannelId;
              if (targetGuildId && targetVcId) {
                console.log(`[IPC] Switching Voice Channel to Guild: ${targetGuildId}, VC: ${targetVcId}`);
                await safeJoinVoice(targetGuildId, targetVcId);
                session.setVoiceChannel(targetVcId);
                state = await session.getState();
              }
              break;
            }

            case 'STOP': {
              await sessionManager.stopSession(guildId);
              break;
            }

            case 'SKIP_INTERMISSION':
            case 'PLAY_NEXT': {
              await session.skipIntermission();
              state = await session.getState();
              break;
            }

            case 'GET_STATE': {
              state = await session.getState();
              break;
            }
          }

          res.writeHead(200);
          res.end(JSON.stringify({ commandId: id, success: true, state }));
        } catch (err) {
          console.error('[IPC] Error processing command:', err);
          res.writeHead(500);
          res.end(JSON.stringify({ success: false, error: (err as Error).message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(config.server.workerPort, '0.0.0.0', () => {
    console.log(`[IPC Server] Listening on http://0.0.0.0:${config.server.workerPort}`);
  });

  return server;
}
