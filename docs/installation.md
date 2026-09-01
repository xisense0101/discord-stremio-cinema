# Installation Guide

## Prerequisites

* **Node.js**: `v20.x` or newer (Recommended: `v22` / `v25`)
* **Package Manager**: `pnpm` (`npm install -g pnpm`)
* **FFmpeg**: `v6.x` or newer with `libx264` and `libzmq` support
* **Chromium / Google Chrome**: Installed on host or container
* **Redis**: (Optional - built-in in-memory fallback enabled by default)

## Step-by-Step Setup

1. **Clone Repository & Enter Directory**:
   ```bash
   cd "/home/xisense/Desktop/discord player"
   ```

2. **Configure Environment Variables**:
   ```bash
   cp infra/.env.example .env
   # Edit .env and supply DISCORD_CONTROLLER_TOKEN, DISCORD_STREAMER_TOKEN, and TORBOX_API_KEY
   ```

3. **Install Dependencies**:
   ```bash
   pnpm install
   ```

4. **Build TypeScript Packages**:
   ```bash
   pnpm run build
   ```

5. **Run Clean-Room Benchmark Suite**:
   ```bash
   pnpm test
   ```

6. **Start Services**:
   * **Terminal 1 (Stream Worker)**:
     ```bash
     pnpm start:worker
     ```
   * **Terminal 2 (Discord Controller)**:
     ```bash
     pnpm start:controller
     ```
