# Audio Management

## Output Capture

Tab audio is captured in stereo or multi-channel at 48kHz and encoded to Opus via `node-av` / FFmpeg.

## Track Switching

Audio streams are selected in the browser session via `HTMLVideoElement.audioTracks[i].enabled = true`.
