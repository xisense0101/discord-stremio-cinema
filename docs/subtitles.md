# Subtitle Management

## Zero-Transcode Subtitle Switching

Subtitles are rendered directly in the Chromium viewport on top of the video canvas.

When the user selects `/subtitles` or clicks the Subtitle button in Discord:
1. The controller sends `SET_SUBTITLE` to the worker.
2. The worker toggles `video.textTracks[i].mode = 'showing' | 'disabled'`.
3. The newly rendered subtitle overlay appears in the stream immediately.
4. **Zero video reload or server-side transcoding occurs.**
