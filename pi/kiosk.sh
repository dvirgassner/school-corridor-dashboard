#!/usr/bin/env bash
# kiosk.sh — launch the board and keep it alive forever.
#
# The `while true` loop IS the watchdog: if Chromium crashes, is killed
# by the OOM killer, or exits for any reason, it comes straight back.
# Nothing here needs a person in the corridor.

set -u
DASH_URL="${DASH_URL:-}"
if [ -z "$DASH_URL" ]; then
  echo "kiosk.sh: DASH_URL is not set (see ~/.dashboard-env)" >&2
  exit 1
fi

# School Wi-Fi and DNS are often not ready when the desktop session
# starts. Wait for the real page rather than guessing with a sleep.
until curl -sfI --max-time 10 "$DASH_URL" >/dev/null 2>&1; do
  echo "waiting for $DASH_URL ..."
  sleep 3
done

# Chromium's own crash/restore bubbles would sit on top of the board
# forever, so clear the exit state before every launch.
PREFS="$HOME/.config/chromium/Default/Preferences"
if [ -f "$PREFS" ]; then
  sed -i 's/"exit_type":"[^"]*"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' "$PREFS" || true
fi

# Pick whichever binary this Raspberry Pi OS release ships.
BROWSER="$(command -v chromium-browser || command -v chromium)"

while true; do
  "$BROWSER" \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-features=Translate \
    --no-first-run \
    --check-for-update-interval=31536000 \
    --autoplay-policy=no-user-gesture-required \
    --disable-pinch \
    --overscroll-history-navigation=0 \
    "$DASH_URL"
  echo "chromium exited ($?) — restarting in 5s"
  sleep 5
done
