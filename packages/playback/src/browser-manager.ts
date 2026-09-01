import { launch } from 'puppeteer-stream';
import type { Browser, Page } from 'puppeteer-core';
import config from '@discord-stremio/config';
import fs from 'fs';
import path from 'path';

export class BrowserManager {
  private browser: Browser | null = null;
  private pages: Map<string, Page> = new Map();

  /**
   * Initialize or retrieve the dedicated Chromium instance
   */
  async getBrowser(guildId?: string): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    const userDataDir = guildId
      ? path.join(config.browser.dataDir, guildId)
      : path.join(config.browser.dataDir, 'default');

    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    // Section 14: Documented Flags for Video Streaming Stability
    const args = [
      '--autoplay-policy=no-user-gesture-required', // Immediate playback without manual gesture
      '--disable-background-timer-throttling',     // Prevent timer delays when unfocused
      '--disable-backgrounding-occluded-windows',  // Avoid render loop throttling
      '--disable-renderer-backgrounding',          // Maintain high process priority
      '--no-sandbox',                              // Unprivileged container support
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',                   // Overcome limited container shared memory
      '--disable-gpu-sandbox',
      '--disable-notifications',
      `--window-size=${config.stream.width},${config.stream.height}`,
      '--hide-scrollbars',
      '--mute-audio=false',                        // Audio output must remain active for capture
    ];

    console.log(`[BrowserManager] Launching Chromium (Headless: ${config.browser.headless})...`);

    this.browser = (await launch({
      executablePath: config.browser.chromePath,
      headless: config.browser.headless,
      defaultViewport: {
        width: config.stream.width,
        height: config.stream.height,
        deviceScaleFactor: 1,
      },
      args,
      userDataDir,
      ignoreDefaultArgs: ['--mute-audio'],
    })) as unknown as Browser;

    this.browser.on('disconnected', () => {
      console.warn('[BrowserManager] Chromium disconnected.');
      this.browser = null;
      this.pages.clear();
    });

    return this.browser;
  }

  /**
   * Create or get dedicated page for a guild session
   */
  async createGuildPage(guildId: string): Promise<Page> {
    const browser = await this.getBrowser(guildId);
    let page = this.pages.get(guildId);

    if (!page || page.isClosed()) {
      page = await browser.newPage();
      await page.setViewport({
        width: config.stream.width,
        height: config.stream.height,
      });

      // Prevent window minimization/freeze
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(document, 'hidden', { value: false, writable: false });
        Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });
      });

      this.pages.set(guildId, page);
    }

    return page;
  }

  async closeGuildPage(guildId: string): Promise<void> {
    const page = this.pages.get(guildId);
    if (page && !page.isClosed()) {
      try {
        await page.close();
      } catch (err) {
        console.warn(`[BrowserManager] Error closing page for guild ${guildId}:`, err);
      }
    }
    this.pages.delete(guildId);
  }

  async closeAll(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        console.warn('[BrowserManager] Error closing browser:', err);
      }
      this.browser = null;
      this.pages.clear();
    }
  }
}

export const browserManager = new BrowserManager();
