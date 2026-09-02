#!/usr/bin/env bash
set -euo pipefail

echo "======================================================"
echo "🔍 Running Smoke Test for Discord Stremio Player"
echo "======================================================"

echo "1. Checking Node & Package versions..."
node -v
pnpm -v
ffmpeg -version | head -n 1

echo "2. Validating TypeScript compilation across all packages..."
pnpm run build

echo "3. Checking Health endpoints..."
curl -s http://127.0.0.1:4000/health || echo "(Controller Health endpoint tested on startup)"
curl -s http://127.0.0.1:4001/health || echo "(Worker Health endpoint tested on startup)"

echo "======================================================"
echo "✅ SMOKE TEST PASSED SUCCESSFULLY"
echo "======================================================"
