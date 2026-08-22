#!/usr/bin/env bash
# setup.sh — provision a Raspberry Pi as the corridor board player.
#
# Usage:
#   DASH_URL="https://user.github.io/repo/dashboard/" \
#   [HEALTHCHECK_URL="https://hc-ping.com/xxxx"] \
#   bash pi/setup.sh
#
# Idempotent: safe to run again after changing the URL.

set -euo pipefail

DASH_URL="${DASH_URL:-}"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"
if [ -z "$DASH_URL" ]; then
  echo "Set DASH_URL first, e.g.:" >&2
  echo '  DASH_URL="https://you.github.io/repo/dashboard/" bash pi/setup.sh' >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> Installing packages"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends \
  chromium-browser cec-utils curl unclutter x11-xserver-utils \
  2>/dev/null || sudo apt-get install -y --no-install-recommends \
  chromium cec-utils curl unclutter

echo "==> Writing ~/.dashboard-env"
cat > "$HOME/.dashboard-env" <<EOF
# Written by pi/setup.sh — edit and reboot to change the board URL.
export DASH_URL="$DASH_URL"
export HEALTHCHECK_URL="$HEALTHCHECK_URL"
EOF

echo "==> Installing ~/kiosk.sh"
install -m 755 "$SCRIPT_DIR/kiosk.sh" "$HOME/kiosk.sh"

# The launcher sources the env file, then execs the kiosk loop.
cat > "$HOME/start-board.sh" <<'EOF'
#!/usr/bin/env bash
set -a; . "$HOME/.dashboard-env"; set +a
# never blank or dim the screen (X11 only; harmless elsewhere)
xset s off -dpms 2>/dev/null || true
unclutter -idle 0 &            # hide the mouse pointer
exec "$HOME/kiosk.sh"
EOF
chmod 755 "$HOME/start-board.sh"

echo "==> Registering autostart for whichever compositor this Pi uses"
# Raspberry Pi OS Bookworm: Wayfire (default) or labwc; older: X11/LXDE.
if [ -f "$HOME/.config/wayfire.ini" ]; then
  if ! grep -q "start-board" "$HOME/.config/wayfire.ini"; then
    printf '\n[autostart]\nboard = %s/start-board.sh\nscreensaver = false\ndpms = false\n' \
      "$HOME" >> "$HOME/.config/wayfire.ini"
  fi
  echo "    wayfire.ini updated"
fi
if [ -d "$HOME/.config/labwc" ] || [ -f "$HOME/.config/labwc/autostart" ]; then
  mkdir -p "$HOME/.config/labwc"
  grep -q "start-board" "$HOME/.config/labwc/autostart" 2>/dev/null || \
    echo "$HOME/start-board.sh &" >> "$HOME/.config/labwc/autostart"
  chmod +x "$HOME/.config/labwc/autostart" 2>/dev/null || true
  echo "    labwc autostart updated"
fi
if [ -d "$HOME/.config/lxsession/LXDE-pi" ]; then
  AF="$HOME/.config/lxsession/LXDE-pi/autostart"
  grep -q "start-board" "$AF" 2>/dev/null || echo "@$HOME/start-board.sh" >> "$AF"
  echo "    LXDE autostart updated"
fi
# Fallback for a Pi with no desktop session file yet.
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/corridor-board.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Corridor Board
Exec=$HOME/start-board.sh
X-GNOME-Autostart-enabled=true
EOF

echo "==> Installing cron jobs (screen schedule, heartbeat, nightly reboot)"
CRON_TMP="$(mktemp)"
crontab -l 2>/dev/null | grep -v "corridor-board" > "$CRON_TMP" || true
cat >> "$CRON_TMP" <<EOF
# corridor-board: TV on at 07:00 on school days (Sun-Fri)
0 7 * * 0-5 echo "on 0" | cec-client -s -d 1 >/dev/null 2>&1 # corridor-board
# corridor-board: TV to standby 17:00 Sun-Thu, 15:00 Fri
0 17 * * 0-4 echo "standby 0" | cec-client -s -d 1 >/dev/null 2>&1 # corridor-board
0 15 * * 5 echo "standby 0" | cec-client -s -d 1 >/dev/null 2>&1 # corridor-board
# corridor-board: TV stays off all Saturday
0 7 * * 6 echo "standby 0" | cec-client -s -d 1 >/dev/null 2>&1 # corridor-board
EOF
if [ -n "$HEALTHCHECK_URL" ]; then
  echo "*/10 * * * * curl -fsS -m 10 --retry 3 \"$HEALTHCHECK_URL\" >/dev/null 2>&1 # corridor-board" >> "$CRON_TMP"
fi
crontab "$CRON_TMP"
rm -f "$CRON_TMP"

# Nightly reboot clears any slow leak. Root crontab, so it can reboot.
sudo bash -c '
  T="$(mktemp)"
  crontab -l 2>/dev/null | grep -v "corridor-board" > "$T" || true
  echo "0 3 * * * /sbin/reboot # corridor-board" >> "$T"
  crontab "$T"; rm -f "$T"
'

echo
echo "==> Done."
echo "    Board URL: $DASH_URL"
echo "    Next: enable console/desktop autologin  ->  sudo raspi-config"
echo "          (System Options -> Boot / Auto Login -> Desktop Autologin)"
echo "    Then: install Tailscale for remote access:"
echo "          curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --ssh"
echo "    Then reboot and confirm the board comes up on its own."
