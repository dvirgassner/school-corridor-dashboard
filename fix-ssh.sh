#!/bin/sh
# fix-ssh.sh — recovers a DreamCompute VPS whose sshd is reachable over
# IPv6 only. TEMPORARY: delete this file once the box is fixed.
#
#   curl -sL https://dvirgassner.github.io/school-corridor-dashboard/fix-ssh.sh | sudo sh
#
# Root cause: /etc/systemd/system/ssh.socket.d/relay-443.conf overrides
# ssh.socket with an IPv6-only ListenStream (or BindIPv6Only=ipv6-only),
# so every IPv4 connection to :22/:443 gets "connection refused" even
# though the interface has a routable IPv4 address and the kernel default
# (net.ipv6.bindv6only=0) would otherwise happily dual-stack. This script
# rewrites the drop-in with explicit v4 *and* v6 binds, and if that still
# doesn't come up on IPv4, removes the drop-in entirely — plain ssh.socket
# on port 22 beats no access at all.

DROPIN=/etc/systemd/system/ssh.socket.d/relay-443.conf

# --- 1. must be root -------------------------------------------------
if [ "$(id -u)" != "0" ]; then
  echo "Must run as root. Re-run as:  sudo sh fix-ssh.sh" >&2
  exit 1
fi

# --- 2. "before" state, for the record --------------------------------
# Printed BEFORE anything is touched — this is the evidence of why the
# box locked itself out, and it would be lost the moment we overwrite it.
echo "=== BEFORE ==="
if [ -f "$DROPIN" ]; then
  echo "--- $DROPIN ---"
  cat "$DROPIN"
else
  echo "(no $DROPIN)"
fi
echo "--- ss -lnt (22/443) ---"
ss -lnt 2>/dev/null | grep -E ':(22|443)'
echo "--- sysctl net.ipv6.bindv6only ---"
sysctl net.ipv6.bindv6only 2>/dev/null

# --- 3. back up the old drop-in, if any --------------------------------
if [ -f "$DROPIN" ]; then
  BACKUP="/root/relay-443.conf.bak-$(date +%s)"
  cp "$DROPIN" "$BACKUP"
  echo "backed up to $BACKUP"
fi

# --- 4. write the corrected drop-in -------------------------------------
# Explicit v4 AND v6 ListenStream lines (the blank ListenStream= first
# clears whatever the unit inherited), plus BindIPv6Only=both so a lone
# v6 line could never again silently exclude v4.
mkdir -p "$(dirname "$DROPIN")"
cat > "$DROPIN" <<'EOF'
[Socket]
ListenStream=
ListenStream=0.0.0.0:22
ListenStream=0.0.0.0:443
ListenStream=[::]:22
ListenStream=[::]:443
BindIPv6Only=both
EOF
echo "wrote corrected $DROPIN"

# --- 5. reload and restart ------------------------------------------
systemctl daemon-reload
systemctl restart ssh.socket

# --- 6. verify, with automatic fallback ------------------------------
echo "=== AFTER ==="
AFTER="$(ss -lnt 2>/dev/null | grep -E ':(22|443)')"
echo "$AFTER"

case "$AFTER" in
  *0.0.0.0:22*)
    RESULT=ok
    ;;
  *)
    echo "!!! FAILED: 0.0.0.0:22 still not listening after the corrected drop-in !!!"
    echo ">>> falling back: removing the drop-in so ssh.socket uses plain defaults <<<"
    rm -f "$DROPIN"
    systemctl daemon-reload
    systemctl restart ssh.socket
    AFTER="$(ss -lnt 2>/dev/null | grep -E ':(22|443)')"
    echo "=== AFTER FALLBACK ==="
    echo "$AFTER"
    case "$AFTER" in
      *0.0.0.0:22*) RESULT=ok_fallback ;;
      *)            RESULT=fail ;;
    esac
    ;;
esac

# --- 7. self-test IPv4 locally ----------------------------------------
# /dev/tcp is a bashism; dash (the usual /bin/sh) doesn't have it, so
# this only runs if bash is present, and its own && / || means a failure
# here can never abort the script (nothing above uses set -e either).
if command -v bash >/dev/null 2>&1; then
  timeout 5 bash -c 'echo > /dev/tcp/127.0.0.1/22' 2>/dev/null && echo SELF_IPV4_OK || echo SELF_IPV4_FAIL
else
  echo "SELF_IPV4_SKIP (no bash on this box)"
fi

# --- 8. summary ---------------------------------------------------------
case "$RESULT" in
  ok)          echo "SUCCESS: corrected drop-in is listening on 0.0.0.0:22 — report this output." ;;
  ok_fallback) echo "SUCCESS (fallback): drop-in removed, plain ssh.socket is listening on 0.0.0.0:22 — report this output." ;;
  *)           echo "FAILED: still no 0.0.0.0:22 after fallback — report this output as-is, do not retry blindly." ;;
esac
