#!/usr/bin/env bash
# relay-tidy.sh — quiet the tunnelling tools that cannot work on this
# network, without throwing away the option of using them later.
#
#   curl -sL https://raw.githubusercontent.com/dvirgassner/school-corridor-dashboard/main/pi/relay-tidy.sh | bash
#
# Optional. Nothing here fixes a fault; it stops wasted work.
#
# The school's filter blocks Tailscale and Cloudflare by category, so
# tailscaled sits in a retry loop against a control server it will never
# reach. On a Pi that is already undervolting, that is CPU spent on a
# certainty. The DAEMON is stopped; the PACKAGE stays, so if the school
# ever allow-lists *.tailscale.com this is two commands to revive rather
# than another drive:
#
#     sudo systemctl enable --now tailscaled
#     sudo tailscale up --ssh
#
# TOUCHES NO NETWORK CONFIGURATION. No Wi-Fi, NetworkManager, DNS, routing
# or firewall — see CLAUDE.md. Removing a package that owns network state
# is exactly the kind of thing that could strand this Pi, so nothing is
# uninstalled here at all.

set -uo pipefail

echo "==> Stopping tailscaled (package kept)"
if systemctl list-unit-files 2>/dev/null | grep -q "^tailscaled\.service"; then
  sudo systemctl disable --now tailscaled >/dev/null 2>&1
  echo "    tailscaled: $(systemctl is-active tailscaled 2>&1) / $(systemctl is-enabled tailscaled 2>&1)"
else
  echo "    not installed — nothing to do"
fi

echo "==> Removing the downloaded installer"
rm -f "$HOME/cf.deb" && echo "    ~/cf.deb removed (or was already gone)"

echo "==> Confirming nothing important moved"
echo "    board-relay : $(systemctl is-enabled board-relay 2>&1) / $(systemctl is-active board-relay 2>&1)"
echo "    sshd        : $(systemctl is-enabled ssh 2>&1) / $(systemctl is-active ssh 2>&1)"
echo "    chromium    : $(pgrep -c chromium) processes"
echo "    wifi        : $(nmcli -t -f NAME connection show --active 2>/dev/null | head -1)"
echo
echo "Done. The board and the relay are untouched."
