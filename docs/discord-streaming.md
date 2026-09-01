# Discord Video Transport & Go-Live

Uses `@dank074/discord-video-stream` and `discord.js-selfbot-v13`.

## Pipeline

```text
Chromium Page
     │
     ▼ (puppeteer-stream)
Readable Stream (VP8 / Opus)
     │
     ▼ (prepareStream)
FFmpeg Transcoder (libopenh264 / x264 'superfast', Opus 128k)
     │
     ▼ (playStream)
Discord Voice Gateway (WebRTC Go-Live RTP)
```
