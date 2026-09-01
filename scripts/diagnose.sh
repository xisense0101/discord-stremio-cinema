#!/usr/bin/env bash
set -euo pipefail

echo "======================================================"
echo "🩺 System Diagnostics & Environment Audit"
echo "======================================================"

echo "--- System & CPU Architecture ---"
uname -a
lscpu | grep "Model name\|Socket\|Thread\|NUMA\|CPU(s):" || true

echo "--- Memory Usage ---"
free -h

echo "--- FFmpeg Codec Capabilities ---"
ffmpeg -codecs 2>/dev/null | grep -E "libx264|libopenh264|libopus|aac|hevc" || true

echo "--- Chromium / Browser Availability ---"
which google-chrome chromium-browser chromium 2>&1 || true

echo "--- Redis Availability ---"
redis-cli ping 2>/dev/null || echo "Redis server is running in memory fallback mode."

echo "--- Node Processes ---"
ps aux | grep -E "node|tsx|ffmpeg|chrome" | grep -v grep || true

echo "======================================================"
echo "✅ DIAGNOSTICS AUDIT COMPLETE"
echo "======================================================"
