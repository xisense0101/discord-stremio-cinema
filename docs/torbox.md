# TorBox Addon & Resolver Integration

## Overview

TorBox provides fast Debrid streaming from cloud storage and CDN nodes.

## Manifest Configuration

1. **Direct TorBox Manifest**:
   ```text
   https://stremio.torbox.app/{TORBOX_API_KEY}/manifest.json
   ```

2. **Torrentio Debrid Integration**:
   ```text
   https://torrentio.strem.fun/torbox={TORBOX_API_KEY}/manifest.json
   ```

## Filtering Strategy

* **Preferred**: `1080p`, cached (`⚡`), H.264 video, 5.1/Stereo audio.
* **Blocked**: CAM, TS, Telesync, HDCAM, Screener releases.
* **Fallback**: When no TorBox key is provided, the resolver falls back to public high-compatibility test streams.
