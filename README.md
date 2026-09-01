# 🎬 Discord Stremio Cinema & Web Controller

A production-grade Discord Movie & TV streaming platform and Web Cinema Controller powered by **Stremio**, **TorBox Debrid**, **Puppeteer**, **FFmpeg**, and **Discord Go-Live WebRTC**.

---

## 🌟 Key Features

* **🎥 Discord Go-Live WebRTC Streaming**: Streams 1080p FHD, 4K UHD, 2K QHD, 720p HD, and 480p SD directly into Discord Voice Channels using low-latency software x264 encoding.
* **🔑 Live Token Health Diagnostics & Hot-Reload Updater**:
  * **Live Health Badges**: Real-time status pills for Discord Streamer User Token, Discord Controller Bot, and TorBox API Key.
  * **Instant Expiration Alert**: Clear red alert banner appears when a streamer user token has expired or rotated.
  * **In-App Token Updater**: Paste a new token in the Web UI to test with the Discord Gateway and hot-reload the streamer account without restarting services.
* **🔊 Persistent Multi-Server & Voice Channel Routing**:
  * **Server & VC Selector**: Dynamic dropdown of all Discord servers the streamer account is in, including live user counts.
  * **Follow-Me Mode**: Enter your Discord User ID and click **"🎯 Find & Join My VC"** to auto-detect and join your current voice channel across all shared servers.
  * **Persistent Channel Target**: Saves your active Voice Channel selection so opening a movie never reverts to `#General`.
* **🌐 Sleek Web Controller & Remote (`apps/web`)**:
  * **Interactive Remote**: Real-time scrubbing progress bar, seek, play/pause, rewind/forward, and stop buttons.
  * **7-Day Persistent Auth**: Minimalist cinematic login (`senzu` / `herewegoagain`) with auto-renewing secure cookies.
  * **Dynamic Stream Resolution**: Instant quality switcher pills with zero audio/video desync.
  * **Frame-Perfect Subtitles**: Hybrid 2-tier subtitle engine (probe embedded text tracks `[Embedded ⚡]` + multi-track OpenSubtitles) with real-time `[ -1.0s ]` `[ -0.5s ]` `[ 0s ]` `[ +0.5s ]` `[ +1.0s ]` micro-delay timing adjusters.
* **📜 Interactive & Scrollable Playback Queue**:
  * **Inline Add Movie**: Search and add custom movie choices directly inside the queue.
  * **In-Place Movie Swapping**: Swap/replace any queued movie with another title without affecting the rest of the queue.
  * **Per-Item Resolution Edit**: Change stream quality for individual queued movies.
  * **Drag & Drop / Reordering**: Move up, move down, remove, and play any queued movie immediately.
  * **Total Runtime Tracker**: Displays accumulated runtime + intermission break times.
* **⏱️ Smart Cinema Marathon Binge Picker**:
  * **Marathon Duration Mode**: Select target duration in **Days & Hours** (e.g. `6 hours`, `1 day 4 hours`).
  * **Guaranteed Movie Completion**: Automatically analyzes and queues high-rated movies from the selected release window (**2015–2025**) and guarantees the **final movie completes its full runtime** even after the timer has elapsed.
* **🍿 2-Minute Intermission Break**:
  * Automatic 2-minute snack break countdown between queued movies with a **"Skip Break & Play Now"** button.

---

## 🏗️ Architecture

```
                                  ┌────────────────────────┐
                                  │   Next.js 14 Web App   │
                                  │   (Port 3000 / Vercel) │
                                  └───────────┬────────────┘
                                              │ HTTP / JSON
                                              ▼
┌────────────────────────┐         ┌────────────────────────┐
│ Discord Controller Bot │◄───────►│  Stream Worker (4001)  │
│      (Port 4000)       │   IPC   │  • FFmpeg Remuxer      │
└────────────────────────┘         │  • Discord Go-Live     │
                                   │  • Token Manager       │
                                   └───────────┬────────────┘
                                               │ WebRTC
                                               ▼
                                  ┌────────────────────────┐
                                  │  Discord Voice Channel │
                                  │   (1080p 30fps Stream) │
                                  └────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Build Workspace Packages
```bash
pnpm build
```

### 3. Start Services
In separate terminal tabs or run them in the background:

```bash
# 1. Stream Worker (Port 4001 IPC / 4002 Remux)
pnpm start:worker

# 2. Discord Controller Bot (Port 4000)
pnpm start:controller

# 3. Next.js Web Dashboard (Port 3000)
pnpm start:web
```

---

## 🔐 Web Dashboard Credentials

* **URL**: `http://localhost:3000` (or your deployed Vercel URL)
* **Username**: `senzu`
* **Password**: `herewegoagain`
* **Session Lifespan**: 7 Days (Persistent & Auto-Renewing)

---

## 🎮 Discord Slash Commands

| Command | Description |
| :--- | :--- |
| `/play <query>` | Search and stream a movie or TV episode |
| `/pause` / `/resume` | Pause or resume current playback |
| `/seek <seconds>` | Jump to specific timestamp |
| `/subtitles` | Choose active subtitle track |
| `/subdelay <offset>` | Micro-adjust subtitle delay in seconds (e.g. `+0.5`, `-1.0`) |
| `/quality <res>` | Switch quality (`1080p`, `4k`, `720p`, `480p`) |
| `/queue` | View and manage upcoming media queue |
| `/random` | Smart random movie selector |
| `/stop` | Stop playback and disconnect |

---

## 🌐 Deploying to Vercel

1. Import the repository in [Vercel](https://vercel.com).
2. Set the **Root Directory** to `apps/web`.
3. Add the following Environment Variables:
   * `JWT_SECRET`: Any random secure string
   * `WORKER_URL`: Public URL of your stream worker (via Cloudflare Tunnel or VPS domain)
   * `DEFAULT_GUILD_ID`: `1543532988229488680`
   * `DEFAULT_VOICE_CHANNEL_ID`: `1543532988795461666`
4. Click **Deploy**!
