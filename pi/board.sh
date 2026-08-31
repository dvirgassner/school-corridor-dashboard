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

# Why not "pgrep/pkill -f kiosk.sh": -f matches the FULL command line of
# EVERY process on the box, including ones that merely mention the string
# "kiosk.sh" without being it — an ssh command running diagnostics against
# this very file, for instance. That killed a maintaining engineer's own
# remote shell mid-restart. start-board.sh records the loop's real PID
# before it execs into kiosk.sh; trust that PID instead, and confirm it
# still IS the kiosk loop (not an unrelated process that has since reused
# the same number) before ever acting on it.
loop_pids() {
  local pid
  [ -f "$HOME/.board.pid" ] || return 0
  pid="$(cat "$HOME/.board.pid" 2>/dev/null)"
  case "$pid" in ''|*[!0-9]*) return 0 ;; esac
  [ -r "/proc/$pid/cmdline" ] || return 0
  tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null | grep -qxF "$HOME/kiosk.sh" && echo "$pid"
}

case "$CMD" in
  stop)
    # order matters: stop the watchdog BEFORE the browser it guards
    PID="$(loop_pids)"
    if [ -n "$PID" ]; then
      kill "$PID" 2>/dev/null || true
      rm -f "$HOME/.board.pid"
    fi
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
