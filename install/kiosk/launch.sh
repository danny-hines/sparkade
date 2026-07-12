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
  "$CHROMIUM" --kiosk --window-size=1024,600 --window-position=0,0 \
    --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
    --autoplay-policy=no-user-gesture-required \
    --use-fake-ui-for-media-stream \
    --check-for-update-interval=31536000 http://127.0.0.1:8080
  sleep 2
done
