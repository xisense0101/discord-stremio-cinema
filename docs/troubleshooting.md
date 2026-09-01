# Troubleshooting Guide

| Issue | Cause | Fix |
| :--- | :--- | :--- |
| `Cannot find module '@lng2004/node-datachannel'` | Native binary missing | Run `cd node_modules/.../@lng2004/node-datachannel && npx prebuild-install -r napi` |
| `403 Forbidden on stream URL` | Expired CDN token | Re-fetch stream via `/movie <query>` |
| Stuttering / Frame Drops | High VPS CPU load | Lower `STREAM_BITRATE_KBPS` in `.env` to `4000` |
| Subtitles not displaying | Track is disabled | Use `/subtitles` command to pick active language |
