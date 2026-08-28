#!/usr/bin/env bash
# relay-setup.sh — give the Pi a way back in when the network blocks
# Tailscale and Cloudflare.
#
#   curl -sL https://raw.githubusercontent.com/dvirgassner/school-corridor-dashboard/main/pi/relay-setup.sh | bash
#
# The school's filter terminates TLS handshakes to controlplane.tailscale.com
# and api.trycloudflare.com — it blocks tunnelling services by category. SSH
# carries no SNI, so it has nothing to match on, and SSH to port 443 was
# confirmed to pass straight through.
#
# So the Pi dials OUT to a relay host and holds a reverse tunnel open. That
# also means the relay does not have to exist yet: this script can run today,
# and the VPS and DNS record can be created afterwards from anywhere. Until
# then the service simply retries, which costs nothing.
#
# NOTHING HERE TOUCHES THE NETWORK CONFIGURATION. No Wi-Fi, no NetworkManager,
# no DNS, no routing, no firewall. The Pi is on a wall in a school and losing
# its connection means losing the board AND the only way back in.

set -euo pipefail

RELAY_HOST="${RELAY_HOST:-relay.gassner.co.il}"
RELAY_USER="${RELAY_USER:-relay}"
RELAY_PORT="${RELAY_PORT:-443}"
REMOTE_PORT="${REMOTE_PORT:-2222}"   # port ON THE RELAY that reaches this Pi
KEY="$HOME/.ssh/id_relay"

echo "==> Installing autossh"
sudo apt-get install -y --no-install-recommends autossh >/dev/null 2>&1 &&
  echo "    installed" || { echo "    FAILED to install autossh" >&2; exit 1; }

echo "==> Creating the Pi's relay key"
mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
if [ -f "$KEY" ]; then
  echo "    already exists, keeping it"
else
  ssh-keygen -t ed25519 -N "" -C "corridor-board-pi" -f "$KEY" >/dev/null
  echo "    created"
fi

echo "==> Installing the tunnel service"
# -M 0 disables autossh's own monitoring port and relies on SSH keepalives,
#       which is the recommended modern setup.
# ExitOnForwardFailure makes a stale forward fail fast so the unit restarts
#       rather than sitting there connected but useless.
# accept-new trusts the relay's key on first sight — the alternative is a
#       prompt no one is present to answer.
sudo tee /etc/systemd/system/board-relay.service >/dev/null <<UNIT
[Unit]
Description=Reverse SSH tunnel so the corridor board can be reached remotely
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
Environment=AUTOSSH_GATETIME=0
ExecStart=/usr/bin/autossh -M 0 -N \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new \
  -o UserKnownHostsFile=$HOME/.ssh/known_hosts_relay \
  -i $KEY -p $RELAY_PORT \
  -R $REMOTE_PORT:localhost:22 $RELAY_USER@$RELAY_HOST
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now board-relay.service >/dev/null 2>&1 || true
echo "    installed and enabled (it will retry until the relay exists)"

echo
echo "=================================================================="
echo " THE PI'S PUBLIC KEY — copy this line somewhere you can find it:"
echo
cat "$KEY.pub"
echo
echo " Then, whenever you like, from anywhere:"
echo "   1. create a small VPS and set its sshd to listen on port $RELAY_PORT"
echo "   2. add user '$RELAY_USER' there and put the key above in its"
echo "      ~/.ssh/authorized_keys"
echo "   3. point $RELAY_HOST at the VPS address (an A record at DreamHost)"
echo
echo " The Pi connects on its own within 30 seconds of all three existing."
echo " Then reach it from your PC with:"
echo "   ssh -J $RELAY_USER@$RELAY_HOST:$RELAY_PORT -p $REMOTE_PORT $USER@localhost"
echo "=================================================================="
