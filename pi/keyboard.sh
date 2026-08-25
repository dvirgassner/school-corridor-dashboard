#!/usr/bin/env bash
# keyboard.sh — English (US) primary, Hebrew secondary, left Alt + left
# Shift to switch.
#
# Why this is part of the project and not a personal preference: this Pi
# is meant to be rescued by whoever is standing in front of it. A
# Hebrew-only layout makes that impossible — every password, path and
# command is Latin, and changing the layout through the desktop settings
# itself asks for a password you cannot type. One wrong default and the
# machine locks out the person trying to fix it.
#
# Run it directly, or let pi/setup.sh call it.

set -euo pipefail

LAYOUTS="us,il"
OPTS="grp:lalt_lshift_toggle"

# 1. System-wide. This is what the text consoles (Ctrl+Alt+F2) use, and
#    the recovery path depends on those being Latin.
if [ -f /etc/default/keyboard ]; then
  sudo sed -i \
    -e "s/^XKBLAYOUT=.*/XKBLAYOUT=\"$LAYOUTS\"/" \
    -e "s/^XKBVARIANT=.*/XKBVARIANT=\",\"/" \
    -e "s/^XKBOPTIONS=.*/XKBOPTIONS=\"$OPTS\"/" \
    /etc/default/keyboard
  grep -q '^XKBOPTIONS=' /etc/default/keyboard || \
    echo "XKBOPTIONS=\"$OPTS\"" | sudo tee -a /etc/default/keyboard >/dev/null
  sudo setupcon --save >/dev/null 2>&1 || true
  echo "    /etc/default/keyboard set to $LAYOUTS"
fi

# 2. labwc (Raspberry Pi OS Bookworm's default compositor)
if [ -d "$HOME/.config/labwc" ] || command -v labwc >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/labwc"
  ENVF="$HOME/.config/labwc/environment"
  touch "$ENVF"
  sed -i '/^XKB_DEFAULT_LAYOUT=/d; /^XKB_DEFAULT_OPTIONS=/d' "$ENVF"
  printf 'XKB_DEFAULT_LAYOUT=%s\nXKB_DEFAULT_OPTIONS=%s\n' "$LAYOUTS" "$OPTS" \
    >> "$ENVF"
  echo "    labwc environment set"
fi

# 3. Wayfire
WF="$HOME/.config/wayfire.ini"
if [ -f "$WF" ]; then
  sed -i '/^xkb_layout *=/d; /^xkb_options *=/d' "$WF"
  if grep -q '^\[input\]' "$WF"; then
    sed -i "s|^\[input\]|[input]\nxkb_layout = $LAYOUTS\nxkb_options = $OPTS|" "$WF"
  else
    printf '\n[input]\nxkb_layout = %s\nxkb_options = %s\n' "$LAYOUTS" "$OPTS" >> "$WF"
  fi
  echo "    wayfire.ini [input] set"
fi

echo
echo "Keyboard: English (US) primary, Hebrew secondary."
echo "Switch with LEFT Alt + LEFT Shift."
echo "Reboot for it to apply everywhere:  sudo reboot"
