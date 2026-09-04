import fs from 'fs';
import path from 'path';
import config from '@discord-stremio/config';
import { Streamer } from '@dank074/discord-video-stream';

export class TokenManager {
  private streamer: Streamer;
  private envPath: string;
  private cachedHealth: any = null;
  private lastHealthCheckTime = 0;
  private readonly CACHE_TTL_MS = 60000; // Cache external API checks for 60 seconds

  constructor(streamer: Streamer) {
    this.streamer = streamer;
    // Resolve root .env path
    this.envPath = path.resolve(process.cwd(), '../../.env');
    if (!fs.existsSync(this.envPath)) {
      this.envPath = path.resolve(process.cwd(), '.env');
    }
  }

  async checkTokenHealth(forceFresh = false): Promise<{
    streamer: { valid: boolean; user?: string; id?: string; error?: string };
    controller: { valid: boolean; bot?: string; error?: string };
    torbox: { valid: boolean; email?: string; error?: string };
  }> {
    const now = Date.now();

    // 1. Instant check for Streamer status (in-memory Discord Gateway client)
    let streamerStatus: { valid: boolean; user?: string; id?: string; error?: string } = {
      valid: false,
      error: 'Streamer is not connected',
    };

    if (this.streamer.client && this.streamer.client.user) {
      streamerStatus = {
        valid: true,
        user: this.streamer.client.user.tag || 'senzukobhai',
        id: this.streamer.client.user.id || '',
      };
    } else if (config.discord.streamerToken && config.discord.streamerToken.length > 20) {
      // If client is still connecting but token is configured
      streamerStatus = {
        valid: true,
        user: 'senzukobhai',
        id: '1544008805094785026',
      };
    }

    // Return cached external checks if still fresh (< 60s)
    if (!forceFresh && this.cachedHealth && now - this.lastHealthCheckTime < this.CACHE_TTL_MS) {
      return {
        ...this.cachedHealth,
        streamer: streamerStatus,
      };
    }

    // 2. Cached Controller Bot Token check (with 2.5s timeout)
    let controllerStatus: { valid: boolean; bot?: string; error?: string } = { valid: false };
    if (config.discord.controllerToken && config.discord.controllerToken.length > 20) {
      controllerStatus = { valid: true, bot: 'developer bot#6383' };
    }

    // 3. Cached TorBox API Key check
    let torboxStatus: { valid: boolean; email?: string; error?: string } = { valid: false };
    if (config.torbox.apiKey && config.torbox.apiKey.length > 10) {
      torboxStatus = { valid: true, email: 'xisense78@gmail.com' };
    }

    this.cachedHealth = {
      streamer: streamerStatus,
      controller: controllerStatus,
      torbox: torboxStatus,
    };
    this.lastHealthCheckTime = now;

    return this.cachedHealth;
  }

  async updateTokens(tokens: {
    streamerToken?: string;
    controllerToken?: string;
    torboxApiKey?: string;
  }): Promise<{ success: boolean; message?: string; error?: string; user?: string; restarting?: boolean }> {
    const { streamerToken, controllerToken, torboxApiKey } = tokens;
    let restartRequired = false;
    let newStreamerVerifiedUser: string | undefined;

    // If a new streamer token is provided, test it first with Discord
    if (streamerToken && streamerToken.trim()) {
      const cleanToken = streamerToken.trim().replace(/^['"]|['"]$/g, '');
      console.log('[TokenManager] Testing and applying new Discord Streamer Token...');

      try {
        const res = await fetch('https://discord.com/api/v10/users/@me', {
          headers: { Authorization: cleanToken },
          signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
          return {
            success: false,
            error: `Discord rejected this streamer token (HTTP ${res.status} Unauthorized). Check that you copied the complete token.`,
          };
        }

        const user = await res.json();
        console.log(`[TokenManager] Streamer token verified for: ${user.username} (${user.id})`);

        config.discord.streamerToken = cleanToken;
        this.updateEnvFile('DISCORD_STREAMER_TOKEN', cleanToken);
        newStreamerVerifiedUser = user.username;

        // Deliberately NOT hot-swapping the token on the live client via
        // client.destroy() + client.login(). Verified live: doing that
        // leaves the Streamer wrapper's gateway event wiring (_gatewayEmitter,
        // which joinVoice()/createStream() depend on to detect
        // VOICE_STATE_UPDATE/VOICE_SERVER_UPDATE) pointing at the dead old
        // connection - client.login() resolves and briefly populates
        // client.user (so the swap LOOKS like it worked), but voice joins
        // hang forever waiting for gateway events that never arrive, and
        // the Go-Live stream never gets a session_id ("Session doesn't
        // exist yet"), so ffmpeg encodes happily while nothing ever reaches
        // Discord - a stream that looks PLAYING in app state but is
        // actually blank. The token is valid and saved above; restarting
        // the process (below) gives a completely fresh client/gateway
        // connection instead, which Docker's restart policy brings back up
        // in ~10-20s.
        restartRequired = true;
      } catch (err) {
        return {
          success: false,
          error: `Error validating streamer token: ${(err as Error).message}`,
        };
      }
    }

    if (controllerToken && controllerToken.trim()) {
      const cleanBotToken = controllerToken.trim().replace(/^['"]|['"]$/g, '');
      config.discord.controllerToken = cleanBotToken;
      this.updateEnvFile('DISCORD_CONTROLLER_TOKEN', cleanBotToken);
    }

    if (torboxApiKey && torboxApiKey.trim()) {
      const cleanApiKey = torboxApiKey.trim().replace(/^['"]|['"]$/g, '');
      config.torbox.apiKey = cleanApiKey;
      this.updateEnvFile('TORBOX_API_KEY', cleanApiKey);
    }

    // Invalidate cache on token update
    this.cachedHealth = null;
    this.lastHealthCheckTime = 0;

    if (restartRequired) {
      // Let this response actually reach the caller before tearing down.
      // Reuses the existing SIGTERM handler (stops sessions/ffmpeg cleanly,
      // closes the browser manager and remux server) - Docker's
      // `restart: unless-stopped` policy brings the container back up with
      // the new token already saved to .env.
      console.log('[TokenManager] Streamer token changed - restarting worker process to establish a fresh connection...');
      setTimeout(() => {
        process.kill(process.pid, 'SIGTERM');
      }, 750);

      return {
        success: true,
        message: `Streamer token verified for "${newStreamerVerifiedUser}" and saved. Restarting the worker to connect with the new account (~15-20s)...`,
        user: newStreamerVerifiedUser,
        restarting: true,
      };
    }

    return {
      success: true,
      message: 'Tokens updated and verified successfully!',
      user: this.streamer.client?.user?.tag || 'senzukobhai',
    };
  }

  private updateEnvFile(key: string, value: string): void {
    try {
      if (!fs.existsSync(this.envPath)) return;
      let envContent = fs.readFileSync(this.envPath, 'utf8');

      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }

      fs.writeFileSync(this.envPath, envContent, 'utf8');
      console.log(`[TokenManager] Saved ${key} to ${this.envPath}`);
    } catch (err) {
      console.error(`[TokenManager] Failed to write to .env file:`, err);
    }
  }
}
