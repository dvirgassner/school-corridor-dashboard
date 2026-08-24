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
  cat >&2 <<'USAGE'
Set DASH_URL first. It must include the sheet fragment, which is what
points the board at the school's Google Sheet:

  DASH_URL="https://you.github.io/repo/dashboard/#t=<token>&g=<gid>,<gid>,<gid>,<gid>" \
    bash pi/setup.sh

The four gids are the schedule, exams, events and messages tabs, in that
order. See sheet-template/README.md for how to collect them.

The token is stored only here on the Pi (~/.dashboard-env) and is never
committed to the repository. Without the fragment the board runs in demo
mode with sample data.
USAGE
  exit 1
fi

# Warn rather than fail: a fragment-less URL is valid (demo mode), but
# on a school wall it is almost certainly a mistake.
#
# Both fragment forms count: #d=<documentId> for a link-shared sheet, and
# #t=<token> for a published one.
case "$DASH_URL" in
  *"#d="*|*"#t="*) : ;;
  *) echo "NOTE: DASH_URL has no #d=/#t= fragment — the board will show DEMO data." >&2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "==> Installing packages"
sudo apt-get update -qq

# One package per apt call, on purpose.
#
# apt aborts the WHOLE transaction on a single unknown package name, so a
# typo in one name silently takes its neighbours down with it — and a
# trailing "|| true" then hides the failure completely. That is exactly
# how a font never got installed while provisioning still reported
# success. Installing individually costs a few seconds and makes each
# outcome visible.
apt_try() {
  for pkg in "$@"; do
    if sudo apt-get install -y --no-install-recommends "$pkg" >/dev/null 2>&1; then
      echo "    installed: $pkg"
    else
      echo "    NOT AVAILABLE (skipped): $pkg" >&2
    fi
  done
}

# The browser is not optional — without it there is no board at all, so
# fail loudly here rather than at the first reboot.
if sudo apt-get install -y --no-install-recommends chromium-browser >/dev/null 2>&1; then
  echo "    installed: chromium-browser"
elif sudo apt-get install -y --no-install-recommends chromium >/dev/null 2>&1; then
  echo "    installed: chromium"
else
  echo "ERROR: no Chromium package available (tried chromium-browser, chromium)." >&2
  exit 1
fi

apt_try cec-utils curl unclutter x11-xserver-utils

# Screenshot tools, so the board can be checked remotely without going to
# the school: grim for Wayland (Bookworm), scrot for X11. Both are tiny,
# and installing both removes a guess about which session is running.
apt_try grim scrot

# Raspberry Pi OS ships no colour-emoji font, so every emoji renders as an
# empty box. The board's own icons are drawn as SVG precisely so they do
# not depend on this, but the special-day calendar still uses emoji.
# Hebrew itself needs nothing extra — the stock fonts render it correctly.
apt_try fonts-noto-color-emoji
fc-cache -f >/dev/null 2>&1 || true

echo "==> Setting the clock (timezone + NTP)"
# The board's "today" and its current-class highlight follow this clock,
# so it has to be both correct and self-correcting. Daylight saving is
# handled by the timezone database — nothing to change twice a year.
sudo timedatectl set-timezone Asia/Jerusalem
sudo timedatectl set-ntp true
sudo systemctl enable --now systemd-timesyncd 2>/dev/null || true
# Cron jobs below fire on this clock too, so a wrong timezone would put
# the TV's on/off schedule hours out.
timedatectl status | sed -n '1,6p' || true

echo "==> Writing ~/.dashboard-env"
cat > "$HOME/.dashboard-env" <<EOF
# Written by pi/setup.sh — edit and reboot to change the board URL.
#
# DASH_URL's #t=...&g=... fragment holds the Google Sheet publish token.
# THIS FILE IS THE ONLY PLACE IT LIVES. It is deliberately not in the
# repository, so the repository can be public without exposing the
# sheet. If the sheet is ever re-published (which changes the token),
# edit the URL here and reboot.
export DASH_URL="$DASH_URL"
export HEALTHCHECK_URL="$HEALTHCHECK_URL"
EOF
chmod 600 "$HOME/.dashboard-env"    # token — keep it to this user

echo "==> Installing ~/kiosk.sh"
install -m 755 "$SCRIPT_DIR/kiosk.sh" "$HOME/kiosk.sh"
install -m 755 "$SCRIPT_DIR/screenshot.sh" "$HOME/screenshot.sh"

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

# A black desktop, so the seconds before Chromium appears look deliberate
# rather than like a Pi that failed to boot into anything.
echo "==> Setting a black desktop background"
mkdir -p "$HOME/.config/pcmanfm/LXDE-pi"
cat > "$HOME/.config/pcmanfm/LXDE-pi/desktop-items-0.conf" <<'EOF'
[*]
wallpaper_mode=color
desktop_bg=#000000
desktop_fg=#000000
show_documents=0
show_trash=0
show_mounts=0
EOF
gsettings set org.gnome.desktop.background primary-color '#000000' 2>/dev/null || true

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
