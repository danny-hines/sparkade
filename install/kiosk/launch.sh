#!/usr/bin/env bash
# Sparkade kiosk launcher: wait for the server, then run Chromium in a relaunch
# loop — a browser crash or slow server boot never strands the cabinet.
set -u

CHROMIUM=chromium
command -v chromium >/dev/null 2>&1 || CHROMIUM=chromium-browser

# Wait up to 60s for the server (systemd may still be starting it).
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:8080/api/system/info >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

while true; do
  # --use-fake-ui-for-media-stream: auto-grant the camera/mic permission (no mouse
  #   to click the prompt on a kiosk).
  # --disable-features=WebRtcPipeWireCamera: on trixie's Chromium (M130+) the camera
  #   defaults to the PipeWire/portal backend, which isn't running in this bare
  #   startx session — so it enumerates zero cameras and getUserMedia hangs. This
  #   forces the direct V4L2 path (/dev/video0). Harmless on older Chromium.
  # DevTools listens only on loopback. `sparkade debug` prints the SSH tunnel
  # needed to reach it, so the debugging protocol is never exposed to the LAN.
  # Chromium 136+ requires a non-default user-data-dir for remote debugging.
  "$CHROMIUM" --kiosk --window-size=1024,600 --window-position=0,0 \
    --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
    --no-first-run --no-default-browser-check \
    --autoplay-policy=no-user-gesture-required \
    --use-fake-ui-for-media-stream \
    --disable-features=WebRtcPipeWireCamera \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port=9222 \
    --user-data-dir="$HOME/.config/chromium-sparkade" \
    --check-for-update-interval=31536000 http://127.0.0.1:8080
  sleep 2
done
