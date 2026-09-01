# Component Version Manifest

| Component | Pinned Version / Commit | Notes |
| :--- | :--- | :--- |
| **Node.js Runtime** | `v25.8.1` | Native ES Modules, top-level await |
| **TypeScript** | `5.7.3` | Strict mode typing |
| **Stremio Web** | `v5.0.0` / Web Runtime | Standardized HTML5 player & subtitle overlay |
| **Puppeteer Core** | `^24.16.2` | Browser automation engine |
| **puppeteer-stream** | `3.0.23` | Browser tab WebRTC/MediaStream capture |
| **@dank074/discord-video-stream** | `6.0.0` | Upstream Go-Live WebRTC transport |
| **discord.js-selfbot-v13** | `3.7.1` | Voice connection and Go-Live signaling |
| **discord.js** | `^14.17.3` | Slash command UI and event controller |
| **FFmpeg** | `6.1.1` (with libzmq, libx264, libopus) | Media transcoding and packet pacing |
| **ioredis** | `^5.4.2` | Distributed state & command pub/sub |
| **pg / SQLite fallback** | `^8.13.1` | Persistent queue & configuration storage |
| **Zod** | `^3.24.2` | Environment and schema validation |

---

## Change Policy
1. Upstream versions MUST NOT be upgraded blindly.
2. Every upgrade requires running all Benchmark Suite tests (Tests A–J).
3. Changes must be documented with verification logs before updating production.
