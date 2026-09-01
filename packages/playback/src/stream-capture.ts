import { getStream } from 'puppeteer-stream';
import type { Page } from 'puppeteer-core';
import type { Readable } from 'stream';

export interface CaptureOptions {
  audio?: boolean;
  video?: boolean;
  frameSize?: number;
  fps?: number;
}

/**
 * Capture both audio and video streams directly from the Puppeteer Chromium page
 * using puppeteer-stream
 */
export async function captureTabMediaStream(
  page: Page,
  options: CaptureOptions = {}
): Promise<Readable> {
  const { audio = true, video = true, frameSize = 1000, fps = 30 } = options;

  console.log(`[StreamCapture] Capturing tab media (Audio: ${audio}, Video: ${video}, FPS: ${fps})...`);

  const mediaStream = await getStream(page as any, {
    audio,
    video,
    frameSize,
    mimeType: 'video/webm;codecs=vp8,opus',
  });

  return mediaStream as unknown as Readable;
}
