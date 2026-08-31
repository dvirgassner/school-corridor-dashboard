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
#
# Strip the fragment first: it holds the sheet token, it is meaningless
# to a server, and this keeps it out of curl's arguments and any logs.
# Also keeps the token out of `ps` output for the check itself.
REACH_URL="${DASH_URL%%#*}"
WAITED=0
until curl -sfI --max-time 10 "$REACH_URL" >/dev/null 2>&1; do
  echo "$(date '+%F %T') waiting for network (${WAITED}s) ..." >>"$HOME/kiosk.log"
  # `9>&-`: start-board.sh's lock (fd 9) survives the exec that got us
  # here and is inherited by every child of this process. If kiosk.sh is
  # ever killed uncleanly while sitting in this sleep, an inherited fd 9
  # would keep the lock held by the orphaned sleep forever, and every
  # later start would wrongly say "another instance already running".
  sleep 3 9>&-
  WAITED=$((WAITED + 3))
  # Give up after 45 seconds. The service worker keeps a copy of the page,
  # so starting without a network usually still shows the board (with
  # yesterday's data and an amber stamp) rather than an error page — far
  # better than staring at a desktop while the school's Wi-Fi wakes up.
  [ "$WAITED" -ge 45 ] && GAVE_UP=1 && break
done

# If we started before the network was ready, Chromium will be sitting on
# its own error page. Watch for the network in the background and kill the
# browser once it appears; the loop below then reloads the real board.
if [ "${GAVE_UP:-0}" = "1" ]; then
  (
    until curl -sfI --max-time 10 "$REACH_URL" >/dev/null 2>&1; do sleep 5; done
    echo "$(date '+%F %T') network arrived — reloading the board" >>"$HOME/kiosk.log"
    pkill -f "$REACH_URL" 2>/dev/null || pkill chromium 2>/dev/null
  ) 9>&- &
  # `9>&-` on this subshell (closing fd 9 before its own `sleep 5` loop
  # forks): it can outlive kiosk.sh for as long as the network takes to
  # come back, so it must never be able to hold the lock by itself — same
  # reasoning as the sleep above.
fi

# Chromium's own crash/restore bubbles would sit on top of the board
# forever, so clear the exit state before every launch.
PREFS="$HOME/.config/chromium/Default/Preferences"
if [ -f "$PREFS" ]; then
  sed -i 's/"exit_type":"[^"]*"/"exit_type":"Normal"/; s/"exited_cleanly":false/"exited_cleanly":true/' "$PREFS" || true
fi

# Pick whichever binary this Raspberry Pi OS release ships.
BROWSER="$(command -v chromium-browser || command -v chromium)"
LOG="$HOME/kiosk.log"

# Restart backoff. A browser that dies immediately, over and over, used to
# look like "the board reloads every few seconds" — the loop was doing
# exactly what it was told, five seconds apart. Backing off makes the
# failure visible instead of disguising it as a flicker.
FAIL=0

while true; do
  STARTED=$(date +%s)
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
    --password-store=basic \
    --use-mock-keychain \
    "$DASH_URL" >>"$LOG" 2>&1
  CODE=$?
  RAN=$(( $(date +%s) - STARTED ))

  if [ "$RAN" -lt 20 ]; then
    FAIL=$((FAIL + 1))
  else
    FAIL=0
  fi

  WAIT=5
  [ "$FAIL" -ge 3 ] && WAIT=30
  [ "$FAIL" -ge 6 ] && WAIT=120
  echo "$(date '+%F %T') chromium exited code=$CODE after ${RAN}s" \
       "(consecutive fast exits: $FAIL) — restarting in ${WAIT}s" >>"$LOG"
  # `9>&-`: this is the exact leak observed today — a backoff sleep that
  # outlived a kiosk.sh killed uncleanly, orphaned, still holding fd 9,
  # so every subsequent `board.sh start` wrongly refused to start.
  sleep "$WAIT" 9>&-
done
