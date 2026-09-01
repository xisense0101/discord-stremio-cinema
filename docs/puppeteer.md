# Chromium & Puppeteer Automation

## Stability Flags

| Flag | Purpose |
| :--- | :--- |
| `--autoplay-policy=no-user-gesture-required` | Immediate media playback without simulated clicks |
| `--disable-background-timer-throttling` | Prevents clock drift when headless window is unfocused |
| `--disable-backgrounding-occluded-windows` | Keeps active rendering loop alive |
| `--disable-renderer-backgrounding` | Ensures high renderer process priority |
| `--no-sandbox` | Unprivileged container compatibility |
| `--mute-audio=false` | Ensures tab audio output remains active for capture |
