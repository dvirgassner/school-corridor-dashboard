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

echo "==> Forcing the HDMI output on, whatever the TV is doing"
# The failure this prevents is nasty because nothing looks broken.
#
# Under the KMS driver, wlroots builds its output list from the HDMI
# connectors the kernel reports as CONNECTED. A TV in standby can drop the
# hotplug line, so if the Pi boots while the screen is asleep the kernel
# reports "disconnected", the compositor invents a headless dummy output,
# and Chromium spends the day rendering the board into nothing. The TV then
# shows a blank screen with a perfectly healthy Pi behind it: kiosk running,
# network fine, no errors in any log. It was diagnosed once from
# `wlr-randr` printing NOOP-1 "Headless output" instead of HDMI-A-1.
#
# That matters here specifically because this board reboots itself at 03:00
# every night, which is exactly when the TV is in standby.
#
# "video=HDMI-A-1:1920x1080@60D" pins the mode; the trailing D forces the
# output on even with no EDID to read. Idempotent, and left alone if
# someone has already set a video= of their own.
CMDLINE=/boot/firmware/cmdline.txt
[ -f "$CMDLINE" ] || CMDLINE=/boot/cmdline.txt
if [ -f "$CMDLINE" ]; then
  if grep -q "video=HDMI" "$CMDLINE"; then
    echo "    already has a video= setting — leaving it alone"
  else
    sudo cp "$CMDLINE" "$CMDLINE.bak-corridor"
    sudo sed -i "s/\$/ video=HDMI-A-1:1920x1080@60D/" "$CMDLINE"
    echo "    added video=HDMI-A-1:1920x1080@60D (backup: $CMDLINE.bak-corridor)"
    echo "    takes effect on the next reboot"
  fi
else
  echo "    !! no cmdline.txt found — set the HDMI mode by hand" >&2
fi

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
install -m 755 "$SCRIPT_DIR/board.sh" "$HOME/board.sh"

# The launcher sources the env file, then execs the kiosk loop.
cat > "$HOME/start-board.sh" <<'EOF'
#!/usr/bin/env bash
# Only ever one board. Two Chromium instances on one profile corrupt each
# other's state ("database is locked") and each crash makes the watchdog
# relaunch, which on screen looks like the page reloading every few
# seconds. The lock survives the exec below, so it is held for the life of
# the kiosk loop.
exec 9>"$HOME/.board.lock"
if ! flock -n 9; then
  echo "$(date '+%F %T') another board instance is already running — exiting" \
    >>"$HOME/kiosk.log"
  exit 0
fi

set -a; . "$HOME/.dashboard-env"; set +a
# never blank or dim the screen (X11 only; harmless elsewhere)
xset s off -dpms 2>/dev/null || true
# Hide the mouse pointer. NOT -idle 0: that means "hide with zero delay",
# which makes classic unclutter poll the pointer in a tight loop instead of
# sleeping between checks. Measured on the live Pi 3B+ it burned 53% of a
# core continuously — a whole core of a four-core board, on hardware that
# was already pinned at 100% and browning out its power supply. With a
# non-zero idle it sits at 0.0%. The two-second delay before the pointer
# vanishes costs nothing: nobody is looking at a corridor board's cursor.
unclutter -idle 2 &
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

echo "==> Registering autostart (exactly one entry)"
# Raspberry Pi OS Bookworm: Wayfire (default) or labwc; older: X11/LXDE.
#
# EXACTLY ONE of these may be registered. Writing the XDG .desktop entry
# on top of a compositor entry launched the board twice, and two Chromium
# instances sharing one profile fight over its database:
#   "Failed to open UKM database: database is locked"
# One of them dies, the watchdog relaunches it, and the whole thing looks
# like a screen that reloads every few seconds.
REGISTERED=""

if [ -f "$HOME/.config/wayfire.ini" ]; then
  if ! grep -q "start-board" "$HOME/.config/wayfire.ini"; then
    printf '\n[autostart]\nboard = %s/start-board.sh\nscreensaver = false\ndpms = false\n' \
      "$HOME" >> "$HOME/.config/wayfire.ini"
  fi
  REGISTERED="wayfire.ini"
elif [ -d "$HOME/.config/labwc" ]; then
  grep -q "start-board" "$HOME/.config/labwc/autostart" 2>/dev/null || \
    echo "$HOME/start-board.sh &" >> "$HOME/.config/labwc/autostart"
  chmod +x "$HOME/.config/labwc/autostart" 2>/dev/null || true
  REGISTERED="labwc/autostart"
elif [ -d "$HOME/.config/lxsession/LXDE-pi" ]; then
  AF="$HOME/.config/lxsession/LXDE-pi/autostart"
  grep -q "start-board" "$AF" 2>/dev/null || echo "@$HOME/start-board.sh" >> "$AF"
  REGISTERED="lxsession autostart"
else
  # No desktop session file to hook into — fall back to XDG autostart.
  mkdir -p "$HOME/.config/autostart"
  cat > "$HOME/.config/autostart/corridor-board.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Corridor Board
Exec=$HOME/start-board.sh
X-GNOME-Autostart-enabled=true
EOF
  REGISTERED="XDG autostart (.desktop)"
fi
echo "    registered via: $REGISTERED"

# Clear a stale .desktop left by an earlier run that registered both.
if [ "$REGISTERED" != "XDG autostart (.desktop)" ] && \
   [ -f "$HOME/.config/autostart/corridor-board.desktop" ]; then
  rm -f "$HOME/.config/autostart/corridor-board.desktop"
  echo "    removed duplicate XDG autostart entry"
fi

# Keyboard layout. Part of provisioning because a Hebrew-only keyboard
# locks out the person standing at the Pi trying to fix it — including
# from the settings dialog that would change it, which asks for a
# password that cannot be typed.
echo "==> Setting keyboard layout (English primary, Hebrew secondary)"
bash "$SCRIPT_DIR/keyboard.sh" || echo "    keyboard setup skipped" >&2

# An escape hatch that works with nothing but a keyboard plugged into the
# TV. If SSH is unreachable — dead Wi-Fi, wrong network, Tailscale down —
# every remote instruction is useless, and the kiosk covers the whole
# screen with no way out.
#
# Ctrl+Alt+B stops the board; Ctrl+Alt+N starts it again. The universal
# fallback, needing no configuration at all, is a text console:
# Ctrl+Alt+F2, log in, run ~/board.sh stop.
echo "==> Registering the keyboard escape hatch (Ctrl+Alt+B / Ctrl+Alt+N)"
if [ -f "$HOME/.config/wayfire.ini" ]; then
  if ! grep -q "board_stop" "$HOME/.config/wayfire.ini"; then
    cat >> "$HOME/.config/wayfire.ini" <<EOF

[command]
binding_board_stop = <ctrl> <alt> KEY_B
command_board_stop = $HOME/board.sh stop
binding_board_start = <ctrl> <alt> KEY_N
command_board_start = $HOME/board.sh start
EOF
  fi
  echo "    wayfire: Ctrl+Alt+B stops, Ctrl+Alt+N starts"
elif [ -f "$HOME/.config/labwc/rc.xml" ]; then
  # Insert into the existing keyboard section rather than replacing the
  # file — a fresh rc.xml would drop labwc's own default keybindings.
  if ! grep -q "board.sh stop" "$HOME/.config/labwc/rc.xml"; then
    python3 - "$HOME/.config/labwc/rc.xml" "$HOME" <<'PY' || \
      echo "    labwc: could not add keybinds — use Ctrl+Alt+F2 instead" >&2
import sys
path, home = sys.argv[1], sys.argv[2]
xml = open(path, encoding="utf-8").read()
binds = (
  '  <keybind key="C-A-b"><action name="Execute" '
  'command="%s/board.sh stop"/></keybind>\n'
  '  <keybind key="C-A-n"><action name="Execute" '
  'command="%s/board.sh start"/></keybind>\n' % (home, home))
if "</keyboard>" in xml:
    xml = xml.replace("</keyboard>", binds + "</keyboard>", 1)
    open(path, "w", encoding="utf-8").write(xml)
else:
    raise SystemExit(1)
PY
  fi
  echo "    labwc: Ctrl+Alt+B stops, Ctrl+Alt+N starts"
else
  echo "    no compositor config found — use Ctrl+Alt+F2 (text console)"
fi

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

# No nightly reboot, by choice.
#
# There used to be a 03:00 reboot here as insurance against slow leaks. It
# was removed because the board is rebooted deliberately when it needs it,
# and an unattended reboot has a real cost on this hardware: it happens at
# 03:00 with the TV in standby, which is exactly the condition that can
# bring the Pi up with no HDMI output at all (see the video= setting
# above). Insurance that can itself blank the screen for a whole school
# day is not insurance.
#
# Any leftover entry from an earlier provisioning run is cleared, so
# re-running this script actually removes the old job rather than leaving
# it behind.
sudo bash -c '
  T="$(mktemp)"
  crontab -l 2>/dev/null | grep -v "corridor-board" > "$T" || true
  crontab "$T"; rm -f "$T"
'
echo "    nightly reboot: not installed (removed if it was there)"

echo
echo "==> Done."
echo "    Board URL: $DASH_URL"
echo "    Next: enable console/desktop autologin  ->  sudo raspi-config"
echo "          (System Options -> Boot / Auto Login -> Desktop Autologin)"
echo "    Then: install Tailscale for remote access:"
echo "          curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --ssh"
echo "    Then reboot and confirm the board comes up on its own."
