# System Architecture

The Discord Stremio Player platform is built by composing proven open-source solutions into a clean control-plane and streaming-plane separation.

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
                  TorBox Resolver        IPC Command Bus
                         │                     │
                         └──────────┬──────────┘
                                    ▼
                          Stream Worker (Go-Live)
                                    │
                                    ▼
                        Chromium Headless Player
                                    │
                         ┌──────────┴──────────┐
                         ▼                     ▼
                    Video Track           Audio Track
                   (1080p Canvas)        (HTML5 Output)
                         │                     │
                         └──────────┬──────────┘
                                    ▼
                          puppeteer-stream
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
   - Introspects metadata without downloading or transcoding media.
   - Synchronizes playback state in Redis.

2. **Player Runtime (`packages/playback`)**:
   - Runs headless Chromium (1920x1080).
   - Loads HTML5 Stremio Web Player and renders WebVTT/canvas subtitles directly onto the viewport.
   - Switches subtitles and audio streams via standard DOM APIs without video re-encoding.

3. **Capture & Transport (`apps/stream-worker`)**:
   - Uses `puppeteer-stream` for unified tab audio/video capture.
   - Transmits streams over Discord Go-Live WebRTC using `@dank074/discord-video-stream`.
