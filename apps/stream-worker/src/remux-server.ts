import http from 'http';
import { spawn, ChildProcess } from 'child_process';

interface ActiveStream {
  cdnUrl: string;
  ffmpegProc?: ChildProcess;
}

export class RemuxServer {
  private server: http.Server | null = null;
  private port: number = 4002;
  private activeStreams: Map<string, ActiveStream> = new Map();

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const url = new URL(req.url || '', `http://127.0.0.1:${this.port}`);
        const guildId = url.pathname.replace('/stream/', '').replace('/', '');
        const streamInfo = this.activeStreams.get(guildId);

        if (!streamInfo || !streamInfo.cdnUrl) {
          res.writeHead(404);
          res.end('No active stream for guild');
          return;
        }

        console.log(`[RemuxServer] Serving fMP4 stream (Stereo 48kHz + Boosted Dialogue) for guild ${guildId}...`);

        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'none',
        });

        // Remux video with 0% transcode (-c:v copy)
        // Downmix multi-channel 5.1/7.1 audio into pristine Stereo 48kHz (-ac 2 -ar 48000 -b:a 256k)
        // Apply volume boost so movie dialogue is clear and loud
        const ffmpeg = spawn('ffmpeg', [
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
          '-i', streamInfo.cdnUrl,
          '-c:v', 'copy',
          '-c:a', 'aac',
          '-ac', '2',
          '-ar', '48000',
          '-b:a', '256k',
          '-af', 'volume=1.35',
          '-f', 'mp4',
          '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
          'pipe:1',
        ]);

        streamInfo.ffmpegProc = ffmpeg;
        ffmpeg.stdout.pipe(res);

        ffmpeg.stderr.on('data', () => {
          // Keep stderr drained
        });

        req.on('close', () => {
          try { ffmpeg.kill('SIGKILL'); } catch {}
        });
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[RemuxServer] Listening on http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  registerStream(guildId: string, cdnUrl: string): string {
    const existing = this.activeStreams.get(guildId);
    if (existing?.ffmpegProc) {
      try { existing.ffmpegProc.kill('SIGKILL'); } catch {}
    }
    this.activeStreams.set(guildId, { cdnUrl });
    return `http://127.0.0.1:${this.port}/stream/${guildId}`;
  }

  unregisterStream(guildId: string): void {
    const existing = this.activeStreams.get(guildId);
    if (existing?.ffmpegProc) {
      try { existing.ffmpegProc.kill('SIGKILL'); } catch {}
    }
    this.activeStreams.delete(guildId);
  }

  stop(): void {
    for (const [, stream] of this.activeStreams) {
      if (stream.ffmpegProc) {
        try { stream.ffmpegProc.kill('SIGKILL'); } catch {}
      }
    }
    this.activeStreams.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

export const remuxServer = new RemuxServer();
