#!/usr/bin/env bash
# board.sh — start, stop and inspect the corridor board.
#
#   ~/board.sh stop      close the browser and stop it relaunching
#   ~/board.sh start     bring it back
#   ~/board.sh restart   reload it (e.g. to pick up a new build)
#   ~/board.sh status    what is running
#
# Why a script rather than "just pkill chromium": the kiosk is a watchdog
# loop whose whole job is to relaunch the browser within five seconds.
# Killing the browser alone gets you the desktop for about as long as it
# takes to read this sentence. The loop has to go first.

set -u
CMD="${1:-status}"

loop_pids() { pgrep -f "kiosk.sh" || true; }

case "$CMD" in
  stop)
    # order matters: stop the watchdog BEFORE the browser it guards
    pkill -f "kiosk.sh" 2>/dev/null || true
    sleep 1
    pkill chromium 2>/dev/null || pkill chromium-browser 2>/dev/null || true
    echo "board stopped — the desktop is yours."
    echo "start it again with: ~/board.sh start   (a reboot also restores it)"
    ;;
  start)
    if [ -n "$(loop_pids)" ]; then
      echo "already running (kiosk loop pid: $(loop_pids | tr '\n' ' '))"
      exit 0
    fi
    setsid "$HOME/start-board.sh" >/dev/null 2>&1 &
    echo "board starting..."
    ;;
  restart)
    "$0" stop >/dev/null
    sleep 1
    "$0" start
    ;;
  status)
    LOOPS="$(loop_pids | wc -l)"
    echo "kiosk loops running : $LOOPS   (should be 1 while the board is up)"
    echo "chromium processes  : $(pgrep -c chromium 2>/dev/null || echo 0)"
    [ -f "$HOME/kiosk.log" ] && {
      echo "last log lines:"
      tail -3 "$HOME/kiosk.log" | sed 's/^/  /'
    }
    ;;
  *)
    echo "usage: $0 {stop|start|restart|status}" >&2
    exit 1
    ;;
esac
