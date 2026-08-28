#!/usr/bin/env bash
# relay-verify.sh — the last checks that can only be done standing at the Pi.
#
#   curl -sL https://raw.githubusercontent.com/dvirgassner/school-corridor-dashboard/main/pi/relay-verify.sh | bash
#
# Everything here exists because it would fail LATER, from home, when it is
# too late to fix. Read-only except for two additive changes: enabling the
# system SSH server, and authorising one public key.
#
# TOUCHES NO NETWORK CONFIGURATION. See CLAUDE.md.

set -uo pipefail
ok()   { echo "  [ok]   $1"; }
warn() { echo "  [WARN] $1"; }
bad()  { echo "  [FAIL] $1"; }

echo "=== 1. the Pi's own SSH server ==="
# This is the trap. Tailscale SSH runs its own server and does NOT need
# the system sshd, so the Pi may never have had one running. The reverse
# tunnel forwards to localhost:22 — with no sshd there, the tunnel would
# connect and then refuse every login.
if systemctl list-unit-files 2>/dev/null | grep -q "^ssh\.service"; then
  sudo systemctl enable ssh >/dev/null 2>&1
  sudo systemctl start ssh  >/dev/null 2>&1
  [ "$(systemctl is-active ssh)" = "active" ] && ok "sshd running and enabled at boot"                                                || bad "sshd will not start"
else
  warn "no ssh.service — installing openssh-server"
  sudo apt-get install -y --no-install-recommends openssh-server >/dev/null 2>&1
  sudo systemctl enable --now ssh >/dev/null 2>&1
  [ "$(systemctl is-active ssh)" = "active" ] && ok "sshd installed and running"                                                || bad "sshd still not running"
fi
ss -lnt 2>/dev/null | grep -q ":22 " && ok "listening on port 22" || bad "nothing on port 22"

echo
echo "=== 2. authorising the PC that will connect ==="
mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"; chmod 600 "$HOME/.ssh/authorized_keys"
KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICdP3edr56wyI1HNKyV6nerlR+6HrJ4q6d8E0gu6adWb dvir-pc-maintenance"
if grep -qF "$KEY" "$HOME/.ssh/authorized_keys"; then
  ok "PC key already authorised"
else
  echo "$KEY" >> "$HOME/.ssh/authorized_keys"
  ok "PC key added to authorized_keys"
fi

echo
echo "=== 3. does SSH on 443 reach hosts other than GitHub? ==="
# GitHub passing does not prove the filter allows 443 generally — it may
# simply be an allow-listed domain. GitLab is a different company and a
# different IP range, so this is the real test of the relay's viability.
OUT=$(ssh -T -o BatchMode=yes -o StrictHostKeyChecking=no         -o ConnectTimeout=12 -p 443 git@altssh.gitlab.com 2>&1)
case "$OUT" in
  *"Welcome to GitLab"*|*"denied"*|*"Permission"*) ok "SSH/443 works to another provider" ;;
  *"imed out"*|*"refused"*|*"closed"*)             bad "SSH/443 blocked beyond GitHub: $OUT" ;;
  *)                                               warn "unclear: $OUT" ;;
esac

echo
echo "=== 4. the relay service ==="
echo "  enabled: $(systemctl is-enabled board-relay 2>&1)"
echo "  active : $(systemctl is-active  board-relay 2>&1)"
systemctl show board-relay -p ExecStart --value 2>/dev/null | tr ' ' '\n' | grep -E "^-R|@" | head -3 | sed 's/^/  target: /'
echo "  (failing to connect is EXPECTED until the relay host exists)"

echo
echo "=== 5. the board itself is untouched ==="
[ "$(pgrep -c chromium)" -gt 0 ] && ok "chromium running ($(pgrep -c chromium) procs)"                                   || warn "chromium not running"
echo "  wifi: $(nmcli -t -f NAME connection show --active 2>/dev/null | head -1)"

echo
echo "=================================================================="
echo " THE PI'S RELAY PUBLIC KEY — this goes on the VPS tonight:"
echo
cat "$HOME/.ssh/id_relay.pub" 2>/dev/null || echo " !! MISSING — rerun relay-setup.sh"
echo "=================================================================="
