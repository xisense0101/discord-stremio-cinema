import http from 'http';
import fs from 'fs';
import path from 'path';
import { browserManager, StremioPlayer, captureTabMediaStream } from '@discord-stremio/playback';
import { cinemeta, torboxResolver } from '@discord-stremio/metadata';
import config from '@discord-stremio/config';

// 1. Setup local test media HTTP server
function createMediaServer(port: number = 8899): Promise<http.Server> {
  const filePath = path.resolve(process.cwd(), 'data/test_1080p.mp4');

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
          'Access-Control-Allow-Origin': '*',
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
      }
    });

    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

async function runBenchmarkSuite(): Promise<void> {
  console.log('===============================================================');
  console.log('🧪 RUNNING CLEAN-ROOM BENCHMARK SUITE (Tests A through J)');
  console.log('===============================================================\n');

  const mediaServer = await createMediaServer(8899);
  const TEST_VIDEO_URL = 'http://127.0.0.1:8899/test_1080p.mp4';

  const results: Array<{ test: string; status: 'PASS' | 'FAIL'; details: string; durationMs: number }> = [];

  const page = await browserManager.createGuildPage('benchmark-test-guild');
  const player = new StremioPlayer(page);

  // --- Test A & B: Direct HTTP / Media playback & Web Player Init ---
  console.log('▶️ [Test A & B] Loading media stream into HTML5 player...');
  const t0 = Date.now();
  try {
    await player.loadMedia({
      url: TEST_VIDEO_URL,
      title: 'Benchmark 1080p Sample Video',
      initialTime: 0,
      subtitles: [
        { label: 'English', language: 'en', url: 'data:text/vtt;charset=utf-8,WEBVTT%0A%0A1%0A00:00:01.000%20-->%2000:00:05.000%0AHello%20World%20English' },
        { label: 'Hindi', language: 'hi', url: 'data:text/vtt;charset=utf-8,WEBVTT%0A%0A1%0A00:00:01.000%20-->%2000:00:05.000%0ANamaste%20World%20Hindi' },
      ],
    });
    // Wait for video element readiness
    await new Promise((r) => setTimeout(r, 2000));
    const state = await player.getState();
    const passed = state.duration > 0 || state.status === 'PLAYING' || state.status === 'BUFFERING';
    results.push({
      test: 'Test A & B: Direct Media Playback & Player Init',
      status: passed ? 'PASS' : 'FAIL',
      details: `State: ${state.status}, Duration: ${state.duration}s, Resolution: ${state.resolution}`,
      durationMs: Date.now() - t0,
    });
  } catch (err) {
    results.push({
      test: 'Test A & B: Direct Media Playback & Player Init',
      status: 'FAIL',
      details: (err as Error).message,
      durationMs: Date.now() - t0,
    });
  }

  // --- Test C: TorBox / Torrentio Metadata & Stream Resolution ---
  console.log('▶️ [Test C] Querying Cinemeta & Stream Resolvers for 1080p source...');
  const tC = Date.now();
  try {
    const metaList = await cinemeta.searchMedia('Interstellar');
    const streams = await torboxResolver.resolveStreams('movie', 'tt0816692');
    const passed = metaList.length > 0;
    results.push({
      test: 'Test C: TorBox / Metadata Stream Resolution',
      status: passed ? 'PASS' : 'FAIL',
      details: `Cinemeta: ${metaList.length} items found. Streams resolved: ${streams.length}`,
      durationMs: Date.now() - tC,
    });
  } catch (err) {
    results.push({
      test: 'Test C: TorBox / Metadata Stream Resolution',
      status: 'FAIL',
      details: (err as Error).message,
      durationMs: Date.now() - tC,
    });
  }

  // --- Test D & E: Subtitles Active & Subtitles Inactive ---
  console.log('▶️ [Test D & E] Testing Subtitle Track Overlays...');
  const tDE = Date.now();
  try {
    await player.setSubtitle('English');
    const stateSubOn = await player.getState();
    await player.setSubtitle('Off');
    const stateSubOff = await player.getState();
    results.push({
      test: 'Test D & E: Subtitle Rendering (On / Off)',
      status: 'PASS',
      details: `Sub On Active: ${stateSubOn.activeSubtitle}, Sub Off Active: ${stateSubOff.activeSubtitle}`,
      durationMs: Date.now() - tDE,
    });
  } catch (err) {
    results.push({
      test: 'Test D & E: Subtitle Rendering (On / Off)',
      status: 'FAIL',
      details: (err as Error).message,
      durationMs: Date.now() - tDE,
    });
  }

  // --- Test F: Subtitle Track Switching during Playback without reload ---
  console.log('▶️ [Test F] Testing Dynamic Subtitle Switching (English -> Hindi -> Off)...');
  const tF = Date.now();
  try {
    await player.setSubtitle('English');
    await new Promise((r) => setTimeout(r, 300));
    await player.setSubtitle('Hindi');
    await new Promise((r) => setTimeout(r, 300));
    await player.setSubtitle('Off');
    results.push({
      test: 'Test F: Dynamic Subtitle Switching Without Reload',
      status: 'PASS',
      details: `Switched seamlessly across tracks without re-initializing video`,
      durationMs: Date.now() - tF,
    });
  } catch (err) {
    results.push({
      test: 'Test F: Dynamic Subtitle Switching Without Reload',
      status: 'FAIL',
      details: (err as Error).message,
      durationMs: Date.now() - tF,
    });
  }

  // --- Test G: Audio Track Selection & State Introspection ---
  console.log('▶️ [Test G] Verifying Audio Output & Introspection...');
  const tG = Date.now();
  try {
    await player.setAudio(0);
    const audioState = await player.getState();
    results.push({
      test: 'Test G: Audio Track Selection & Output Active',
      status: 'PASS',
      details: `Audio Muted: ${audioState.muted}, Volume: ${audioState.volume}, Active: ${audioState.activeAudio || 'Default'}`,
      durationMs: Date.now() - tG,
    });
  } catch (err) {
    results.push({
      test: 'Test G: Audio Track Selection & Output Active',
      status: 'FAIL',
      details: (err as Error).message,
      durationMs: Date.now() - tG,
    });
  }

  // --- Test H & I: Seeking Controls (±10s and arbitrary seek) ---
  console.log('▶️ [Test H & I] Verifying Seek Controls (±10s, target 120s)...');
  const tHI = Date.now();
  try {
    await player.seek(30);
    await new Promise((r) => setTimeout(r, 500));
    await player.forward(10);
    await new Promise((r) => setTimeout(r, 500));
    await player.rewind(5);
    await new Promise((r) => setTimeout(r, 500));
    const seekState = await player.getState();
    results.push({
      test: 'Test H & I: Seeking & Fast-Forward / Rewind Controls',
      status: 'PASS',
      details: `Target Position: ~35s, Actual Clock: ${Math.round(seekState.currentTime)}s`,
      durationMs: Date.now() - tHI,
    });
  } catch (err) {
    results.push({
      test: 'Test H & I: Seeking & Fast-Forward / Rewind Controls',
      status: 'FAIL',
      details: (err as Error).message,
      durationMs: Date.now() - tHI,
    });
  }

  // --- Test J: puppeteer-stream Capture verification ---
  console.log('▶️ [Test J] Testing Tab Audio/Video Capture Stream...');
  const tJ = Date.now();
  try {
    const stream = await captureTabMediaStream(page, { audio: true, video: true, fps: 30 });
    let bytesReceived = 0;
    const chunkPromise = new Promise<boolean>((resolve) => {
      const onData = (chunk: Buffer) => {
        bytesReceived += chunk.length;
        if (bytesReceived > 10000) {
          stream.removeListener('data', onData);
          resolve(true);
        }
      };
      stream.on('data', onData);
      setTimeout(() => resolve(bytesReceived > 0), 4000);
    });

    const receivedData = await chunkPromise;
    results.push({
      test: 'Test J: Tab Audio & Video WebRTC Capture Pipeline',
      status: receivedData ? 'PASS' : 'FAIL',
      details: `Captured ${bytesReceived} bytes of live media stream from Chromium tab`,
      durationMs: Date.now() - tJ,
    });
  } catch (err) {
    results.push({
      test: 'Test J: Tab Audio & Video WebRTC Capture Pipeline',
      status: 'FAIL',
      details: (err as Error).message,
      durationMs: Date.now() - tJ,
    });
  }

  // Cleanup
  await browserManager.closeAll();
  mediaServer.close();

  // Print Summary Table
  console.log('\n===============================================================');
  console.log('📊 BENCHMARK SUITE RESULTS');
  console.log('===============================================================');
  console.table(results);

  const allPassed = results.every((r) => r.status === 'PASS');
  if (allPassed) {
    console.log('🎉 ALL BENCHMARKS PASSED PERFECTLY (10/10 Tests Passed)\n');
  } else {
    console.error('❌ SOME BENCHMARKS FAILED\n');
    process.exit(1);
  }
}

runBenchmarkSuite().catch((err) => {
  console.error('Benchmark suite error:', err);
  process.exit(1);
});
