# System Architecture

The Discord Stremio Player platform separates a lightweight control plane from a single streaming worker that talks to Discord's Go-Live WebRTC transport directly.

```text
                                  User
                                    │
                                    │ /movie Interstellar
                                    ▼
                         Discord Controller (Bot)
                                    │
                         ┌──────────┴──────────┐
                         │                     │
                         ▼                     ▼
                  Cinemeta Catalog      Redis State Store
                         │                     │
                         ▼                     ▼
             AIOStreams / TorBox Resolver   IPC Command Bus (HTTP)
                         │                     │
                         └──────────┬──────────┘
                                    ▼
                          Stream Worker (Go-Live)
                                    │
                                    ▼
                     Direct CDN URL resolution
                        (redirect-follow + probe)
                                    │
                                    ▼
                      FFmpeg (software x264, zerolatency)
                     scale + subtitle burn-in + audio mix
                                    │
                                    ▼
                    @dank074/discord-video-stream
                                    │
                                    ▼
                         Discord Voice Channel
```

## Layer Separation

1. **Control Plane (`apps/controller`)**:
   - Handles Discord slash commands (`/movie`, `/play`, `/pause`, `/seek`, etc.) and UI buttons.
   - Resolves metadata/stream candidates via AIOStreams (primary) and TorBox (direct CDN resolution/fallback) without downloading or transcoding media itself.
   - Synchronizes playback state in Redis, dispatches commands to the worker over HTTP IPC.

2. **Capture & Transport (`apps/stream-worker`)**:
   - Resolves the final direct CDN URL for the selected stream (following redirects, probing for embedded subtitle/audio tracks).
   - Feeds that URL straight into FFmpeg (software x264, `zerolatency` tune) for scaling, subtitle burn-in, and audio remixing - there is no browser/Chromium in this path.
   - Transmits the encoded output over Discord Go-Live WebRTC using `@dank074/discord-video-stream`.
   - One worker process wraps exactly one Discord account/voice connection, so only one guild can be actively streaming at a time per worker. Scaling to more concurrent streams requires additional (worker process, Discord account) pairs, not just more CPU.

> **Note:** `packages/playback` (headless Chromium + Stremio web player, via `puppeteer-stream`) exists in the repo but is **not** part of the production playback path above - it's an earlier/alternate approach that nothing currently invokes.
