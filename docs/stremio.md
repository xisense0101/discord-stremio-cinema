# Stremio Web Player Integration

Stremio Web provides the standardized media player UI and subtitle canvas.

## Key Invariants

1. **No Custom Player Re-invention**: Uses the HTML5 player with WebVTT subtitle track rendering.
2. **Deterministic Playback Clock**: Authoritative time and state are read directly from `HTMLVideoElement.currentTime`, `video.duration`, and `video.buffered`.
3. **Stall Detection**: If `video.currentTime` does not advance for >4 seconds during `PLAYING`, the worker triggers buffering diagnostics.
