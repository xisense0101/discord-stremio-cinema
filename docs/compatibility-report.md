# COMPATIBILITY & ARCHITECTURE REPORT
**Discord Stremio Player Platform Integration**
*Milestone 1 Deliverable — Section 80 Specification*

---

## 1. Executive Summary

This report establishes the baseline technical compatibility matrix for composing the production-oriented Discord movie/TV streaming system using mature open-source components. The architecture eliminates custom NAL parsers, custom RTP packetizers, and custom FFmpeg remuxing pipelines by integrating **Stremio Web**, **TorBox**, **Chromium/Puppeteer**, **puppeteer-stream**, and **@dank074/discord-video-stream**.

```text
User Request (/movie)
       │
       ▼
Discord Controller (discord.js v14)
       │
       ▼ (Redis / Internal Event Bus)
Stream Worker (Node.js + Puppeteer)
       │
       ▼
Stremio Web (Chromium 1920x1080)
       │
       ▼
TorBox Stremio Addon / CDN
       │
       ▼
HTML5 Web Media Player (Video + Subtitle Overlay + Audio Track)
       │
       ▼
puppeteer-stream (Unified MediaStream Capture)
       │
       ▼
@dank074/discord-video-stream (H.264 + Opus Go-Live Transport)
       │
       ▼
Discord Voice Channel / Go-Live
```

---

## 2. Component Evaluation

### 2.1 Stremio Web
* **Release Target**: Stremio Web v5.0.0 / Web Player Runtime (`https://web.stremio.com` or pinned containerized web distribution).
* **Browser Compatibility**: Full modern Chromium (v120+) HTML5 video element support, MediaSource Extensions (MSE), Canvas 2D / WebGL subtitle rendering.
* **Subtitle Capabilities**:
  * In-player WebVTT / ASS / SRT rendering directly onto the canvas overlay.
  * Instant subtitle track switching (`English`, `English SDH`, `Hindi`, `Nepali`, `Japanese`, `Off`) without video reload or server-side transcoding.
  * Subtitle styling and size scaling handled client-side inside Chromium.
* **Player API & Controls**:
  * URL routing / deep-linking: `#/metadetails/movie/{imdb_id}`, `#/player/movie/{stream_url}`.
  * Direct DOM / HTML5 media element access (`video.play()`, `video.pause()`, `video.currentTime`, `video.duration`, `video.textTracks`).
  * Stremio event bus and player state introspection for zero-guesswork playback tracking (`PLAYING`, `PAUSED`, `BUFFERING`, `ENDED`).

### 2.2 TorBox
* **Addon Mechanism**:
  * Official TorBox Stremio Manifest: `https://stremio.torbox.app/{TORBOX_API_KEY}/manifest.json`.
  * Secondary / Fallback provider: Torrentio configured with TorBox Debrid provider (`https://torrentio.strem.fun/torbox={TORBOX_API_KEY}/manifest.json`).
* **API Key Handling**:
  * Injected strictly on the server-side controller/worker configuration.
  * Never exposed to Discord chat or frontend client logs.
* **1080p Stream Behavior**:
  * Direct HTTP/HTTPS streams from TorBox CDN.
  * Standard H.264 video codec and AAC/AC3/E-AC3/Opus audio codec delivery.
  * Fast seeking with HTTP range requests handled natively by Chromium's network stack.

### 2.3 AIOStreams Evaluation
* **Necessity**: **OPTIONAL** (disabled by default in `torbox-direct` mode).
* **Role**: Only activated when multiple Debrid providers, custom stream sorting, or non-TorBox fallbacks are explicitly enabled.
* **Mode Toggle**:
  * Mode A: `RESOLVER_MODE=torbox-direct` (Default, lowest latency, zero proxy overhead).
  * Mode B: `RESOLVER_MODE=aiostreams` (Aggregated multi-source resolution).

### 2.4 Puppeteer & Chromium
* **Version**: `puppeteer` v24.x / `puppeteer-core` with matching Google Chrome / Chromium build.
* **Browser Flags**:
  * `--autoplay-policy=no-user-gesture-required`: Ensures immediate media playback without requiring simulated mouse clicks.
  * `--disable-background-timer-throttling`: Prevents JS timers and video playback from throttling when headless or unfocused.
  * `--disable-backgrounding-occluded-windows`: Maintains active rendering loop.
  * `--disable-renderer-backgrounding`: Keeps renderer process priority high.
  * `--no-sandbox`: Required for unprivileged container environments.
  * `--window-size=1920,1080`: Fixed 1080p viewport for native pixel-perfect capture.
* **Profile Management**: Isolated per-guild Chromium profiles stored in `./data/chromium-profiles/{guildId}`.

### 2.5 puppeteer-stream
* **Version**: `puppeteer-stream` v3.0.23.
* **Capabilities**:
  * Direct Chromium tab capture capturing both audio and video tracks into a unified WebM/VP8/Opus or raw stream.
  * Constant framerate generation (30 FPS) with low CPU overhead.
  * Exposes standard Node.js `Readable` stream for direct consumption by the Discord streamer.

### 2.6 Discord Video Streaming Library
* **Repository**: `@dank074/discord-video-stream` (v6.0.0) + `discord.js-selfbot-v13`.
* **Transport Protocol**: Discord Go-Live (WebRTC / RTP over Discord Voice Gateway with end-to-end encryption).
* **Video Encoding**:
  * `prepareStream(readableStream, { height: 1080, frameRate: 30, videoCodec: "H264", bitrateVideo: 5000, bitrateVideoMax: 7500 })`.
  * Software encoding via `libopenh264` / `x264` (`preset: superfast`).
  * Hardware acceleration via NVENC / VA-API when available.
* **Audio Handling**: Unified Opus encoding via `node-av` / FFmpeg.
* **Account Architecture**:
  * **Controller**: Standard Discord Bot Token (`discord.js` v14) for slash commands, embeds, button interactions.
  * **Stream Worker**: Dedicated Go-Live Streaming Account Token (`discord.js-selfbot-v13`) strictly for voice channel WebRTC media streaming.

---

## 3. VPS & Hardware Sizing

| Metric | Minimum Specification | Recommended Production |
| :--- | :--- | :--- |
| **vCPU** | 2 vCPU | 4 vCPU (x86_64, AVX2 enabled) |
| **RAM** | 4 GB | 8 GB |
| **Network Outbound** | 25 Mbps | 100+ Mbps (low jitter to Discord voice servers) |
| **Disk Space** | 10 GB SSD | 25 GB NVMe SSD |
| **Active Sessions** | 1 session per 2–4 vCPU | 2 concurrent 1080p sessions per 4 vCPU |

---

## 4. Benchmark & Acceptance Plan

All 10 required clean-room benchmarks (Tests A through J) will execute prior to production sign-off:
* **Test A**: Local H.264/AAC MP4 → Chromium → puppeteer-stream → Discord VC.
* **Test B**: Direct HTTP H.264/AAC → Chromium → Discord VC.
* **Test C**: TorBox 1080p stream → Stremio → Discord VC.
* **Test D**: TorBox 1080p with active subtitles → Discord VC.
* **Test E**: TorBox 1080p without subtitles.
* **Test F**: Dynamic subtitle switching during playback (English → Hindi → Off).
* **Test G**: Dynamic audio track switching during playback.
* **Test H**: Incremental seek (±10s).
* **Test I**: Arbitrary long seek.
* **Test J**: 30–60 minute continuous soak test verifying zero A/V drift and zero packet corruption.

---

## 5. Security & Isolation Invariants

1. **Token Protection**: No bot or user tokens logged, committed, or transmitted in client payloads.
2. **CDN URL Masking**: Authenticated TorBox CDN URLs are sanitized from public Discord messages.
3. **Session Concurrency**: Distributed Redis locks (`playback-lock:{guildId}`) ensure strictly serialized playback operations per Discord server.
