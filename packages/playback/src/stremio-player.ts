import type { Page } from 'puppeteer-core';
import { PlayerState, PlaybackOptions, SubtitleTrack, AudioTrack } from './types.js';

export class StremioPlayer {
  private page: Page;
  private currentTitle: string = 'No Media Loaded';
  private stallCount: number = 0;
  private lastPosition: number = 0;
  private lastProgressTimestamp: number = Date.now();

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Load media into the browser player environment
   */
  async loadMedia(options: PlaybackOptions): Promise<void> {
    this.currentTitle = options.title;
    this.stallCount = 0;
    this.lastPosition = options.initialTime || 0;
    this.lastProgressTimestamp = Date.now();

    // HTML5 Stremio Web Player container with WebVTT Subtitle Overlay
    const playerHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Stremio Web Player</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body, html {
            width: 100%;
            height: 100%;
            background: #000;
            overflow: hidden;
            font-family: 'Inter', system-ui, sans-serif;
          }
          #player-container {
            position: relative;
            width: 100vw;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          video {
            width: 100%;
            height: 100%;
            object-fit: contain;
            background: #000;
          }
          /* Custom Subtitle Styling per Section 9 */
          ::cue {
            background-color: rgba(0, 0, 0, 0.75);
            color: #ffffff;
            font-family: 'Inter', system-ui, sans-serif;
            font-size: 38px;
            font-weight: 600;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.9);
            line-height: 1.4;
          }
          #subtitle-overlay {
            position: absolute;
            bottom: 60px;
            left: 5%;
            width: 90%;
            text-align: center;
            pointer-events: none;
            color: #ffffff;
            font-size: 38px;
            font-weight: 600;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.9);
            z-index: 10;
          }
        </style>
      </head>
      <body>
        <div id="player-container">
          <video id="stremio-video" playsinline crossorigin="anonymous" autoplay></video>
          <div id="subtitle-overlay"></div>
        </div>
      </body>
      </html>
    `;

    await this.page.setContent(playerHtml, { waitUntil: 'domcontentloaded' });

    // Inject Media Source and Track Handlers
    await this.page.evaluate(
      ({ streamUrl, initialTime, subtitles }) => {
        const video = document.getElementById('stremio-video') as HTMLVideoElement;
        video.src = streamUrl;
        video.currentTime = initialTime || 0;
        video.volume = 1.0;
        video.muted = false;

        // Clear existing tracks
        while (video.firstChild) {
          video.removeChild(video.firstChild);
        }

        // Add subtitle tracks if available
        if (subtitles && Array.isArray(subtitles)) {
          subtitles.forEach((sub, idx) => {
            const track = document.createElement('track');
            track.kind = 'subtitles';
            track.label = sub.label;
            track.srclang = sub.language;
            track.src = sub.url;
            if (idx === 0) track.default = true;
            video.appendChild(track);
          });
        }

        video.play().catch((e) => console.warn('Auto-play blocked or waiting:', e));
      },
      {
        streamUrl: options.url,
        initialTime: options.initialTime || 0,
        subtitles: options.subtitles || [],
      }
    );
  }

  async play(): Promise<void> {
    await this.page.evaluate(() => {
      const video = document.getElementById('stremio-video') as HTMLVideoElement;
      if (video) video.play();
    });
  }

  async pause(): Promise<void> {
    await this.page.evaluate(() => {
      const video = document.getElementById('stremio-video') as HTMLVideoElement;
      if (video) video.pause();
    });
  }

  async resume(): Promise<void> {
    await this.play();
  }

  async seek(seconds: number): Promise<void> {
    await this.page.evaluate((pos) => {
      const video = document.getElementById('stremio-video') as HTMLVideoElement;
      if (video) {
        video.currentTime = Math.max(0, Math.min(pos, video.duration || pos));
      }
    }, seconds);
    this.lastPosition = seconds;
  }

  async forward(seconds: number = 10): Promise<void> {
    await this.page.evaluate((sec) => {
      const video = document.getElementById('stremio-video') as HTMLVideoElement;
      if (video) {
        video.currentTime = Math.min(video.currentTime + sec, video.duration || video.currentTime + sec);
      }
    }, seconds);
  }

  async rewind(seconds: number = 10): Promise<void> {
    await this.page.evaluate((sec) => {
      const video = document.getElementById('stremio-video') as HTMLVideoElement;
      if (video) {
        video.currentTime = Math.max(0, video.currentTime - sec);
      }
    }, seconds);
  }

  /**
   * Subtitle Switching without re-encode per Section 9 & 70
   */
  async setSubtitle(languageOrLabel: string): Promise<boolean> {
    return this.page.evaluate((target) => {
      const video = document.getElementById('stremio-video') as HTMLVideoElement;
      if (!video || !video.textTracks) return false;

      const isOff = target.toLowerCase() === 'off' || target.toLowerCase() === 'none';

      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (isOff) {
          track.mode = 'disabled';
        } else if (
          track.label.toLowerCase() === target.toLowerCase() ||
          track.language.toLowerCase() === target.toLowerCase()
        ) {
          track.mode = 'showing';
        } else {
          track.mode = 'disabled';
        }
      }
      return true;
    }, languageOrLabel);
  }

  /**
   * Audio Track Selection per Section 11 & 71
   */
  async setAudio(indexOrId: string | number): Promise<boolean> {
    return this.page.evaluate((target) => {
      const video = document.getElementById('stremio-video') as any;
      if (!video || !video.audioTracks) return false;

      for (let i = 0; i < video.audioTracks.length; i++) {
        const track = video.audioTracks[i];
        if (String(i) === String(target) || track.label === target || track.id === target) {
          track.enabled = true;
        } else {
          track.enabled = false;
        }
      }
      return true;
    }, indexOrId);
  }

  /**
   * Introspect authoritative player state directly from the DOM
   */
  async getState(): Promise<PlayerState> {
    try {
      const domState = await this.page.evaluate(() => {
        const video = document.getElementById('stremio-video') as HTMLVideoElement;
        if (!video) return null;

        let bufferedEnd = 0;
        if (video.buffered && video.buffered.length > 0) {
          bufferedEnd = video.buffered.end(video.buffered.length - 1);
        }

        const subtitles: SubtitleTrack[] = [];
        let activeSubtitle = 'Off';
        if (video.textTracks) {
          for (let i = 0; i < video.textTracks.length; i++) {
            const t = video.textTracks[i];
            const isActive = t.mode === 'showing';
            if (isActive) activeSubtitle = t.label || t.language;
            subtitles.push({
              id: String(i),
              label: t.label || `Track ${i + 1}`,
              language: t.language || 'und',
              kind: t.kind,
              active: isActive,
            });
          }
        }

        const audioTracks: AudioTrack[] = [];
        let activeAudio = 'Default';
        const vAny = video as any;
        if (vAny.audioTracks) {
          for (let i = 0; i < vAny.audioTracks.length; i++) {
            const a = vAny.audioTracks[i];
            if (a.enabled) activeAudio = a.label || `Audio ${i + 1}`;
            audioTracks.push({
              id: a.id || String(i),
              label: a.label || `Audio ${i + 1}`,
              language: a.language || 'und',
              enabled: a.enabled,
            });
          }
        }

        let status: 'IDLE' | 'BUFFERING' | 'PLAYING' | 'PAUSED' | 'ENDED' | 'ERROR' = 'IDLE';
        if (video.error) {
          status = 'ERROR';
        } else if (video.ended) {
          status = 'ENDED';
        } else if (video.paused) {
          status = 'PAUSED';
        } else if (video.seeking || video.readyState < 3) {
          status = 'BUFFERING';
        } else {
          status = 'PLAYING';
        }

        return {
          status,
          currentTime: video.currentTime || 0,
          duration: isNaN(video.duration) ? 0 : video.duration,
          bufferedTime: bufferedEnd,
          subtitles,
          activeSubtitle,
          audioTracks,
          activeAudio,
          volume: video.volume,
          muted: video.muted,
          videoWidth: video.videoWidth || 1920,
          videoHeight: video.videoHeight || 1080,
          errorMessage: video.error ? video.error.message : undefined,
        };
      });

      if (!domState) {
        return {
          status: 'IDLE',
          title: this.currentTitle,
          currentTime: 0,
          duration: 0,
          bufferedTime: 0,
          subtitles: [],
          audioTracks: [],
          volume: 1,
          muted: false,
          fps: 30,
          resolution: '1920x1080',
          stallCount: this.stallCount,
          updatedAt: Date.now(),
        };
      }

      // Check for stalled playback per Section 44
      const now = Date.now();
      if (domState.status === 'PLAYING') {
        if (Math.abs(domState.currentTime - this.lastPosition) < 0.1) {
          if (now - this.lastProgressTimestamp > 4000) {
            domState.status = 'BUFFERING';
            this.stallCount++;
          }
        } else {
          this.lastPosition = domState.currentTime;
          this.lastProgressTimestamp = now;
        }
      }

      return {
        status: domState.status,
        title: this.currentTitle,
        currentTime: domState.currentTime,
        duration: domState.duration,
        bufferedTime: domState.bufferedTime,
        subtitles: domState.subtitles,
        activeSubtitle: domState.activeSubtitle,
        audioTracks: domState.audioTracks,
        activeAudio: domState.activeAudio,
        volume: domState.volume,
        muted: domState.muted,
        fps: 30,
        resolution: `${domState.videoWidth}x${domState.videoHeight}`,
        stallCount: this.stallCount,
        errorMessage: domState.errorMessage,
        updatedAt: now,
      };
    } catch (err) {
      return {
        status: 'ERROR',
        title: this.currentTitle,
        currentTime: this.lastPosition,
        duration: 0,
        bufferedTime: 0,
        subtitles: [],
        audioTracks: [],
        volume: 1,
        muted: false,
        fps: 30,
        resolution: '1920x1080',
        stallCount: this.stallCount,
        errorMessage: (err as Error).message,
        updatedAt: Date.now(),
      };
    }
  }
}
