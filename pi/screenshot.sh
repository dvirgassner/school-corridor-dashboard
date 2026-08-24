#!/usr/bin/env bash
# screenshot.sh — capture whatever the TV is currently showing and write
# a PNG to stdout, so it can be pulled over SSH in one command:
#
#   ssh kit 'bash ~/school-corridor-dashboard/pi/screenshot.sh' > board.png
#
# Writing to stdout rather than a file means nothing is left behind on the
# Pi's SD card, which is the component most likely to wear out.
#
# Raspberry Pi OS Bookworm runs Wayland (labwc or Wayfire), where `grim`
# is the capture tool; older releases run X11, where `scrot` is. This
# detects which session is actually live instead of assuming.

set -u

RUNDIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# ---- Wayland ----
if [ -d "$RUNDIR" ]; then
  for sock in "$RUNDIR"/wayland-*; do
    case "$sock" in
      *.lock) continue ;;
    esac
    [ -S "$sock" ] || continue
    if command -v grim >/dev/null 2>&1; then
      export XDG_RUNTIME_DIR="$RUNDIR"
      export WAYLAND_DISPLAY="$(basename "$sock")"
      exec grim -                      # PNG on stdout
    fi
    echo "screenshot.sh: Wayland session found but 'grim' is not installed." >&2
    echo "  sudo apt install -y grim" >&2
    exit 1
  done
fi

# ---- X11 ----
if command -v scrot >/dev/null 2>&1; then
  export DISPLAY="${DISPLAY:-:0}"
  TMP="$(mktemp --suffix=.png)"
  trap 'rm -f "$TMP"' EXIT
  # -o overwrites the (already existing) temp file
  if scrot -o "$TMP" 2>/dev/null; then
    cat "$TMP"
    exit 0
  fi
  echo "screenshot.sh: scrot could not read DISPLAY=$DISPLAY." >&2
  exit 1
fi

echo "screenshot.sh: no display session found." >&2
echo "  Is the desktop running? Are you logged in as the same user as the kiosk?" >&2
exit 1
