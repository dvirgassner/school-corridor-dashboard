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
#
# This is normally run from a laggy noVNC browser console that CANNOT
# SCROLL, so console output is kept to a handful of short lines. The
# full verbose record (before/after state, backup path, fallback steps)
# is written to LOG instead — read it over SSH once access is back, or
# paste it if asked.

DROPIN=/etc/systemd/system/ssh.socket.d/relay-443.conf
LOG=/root/fix-ssh.log

# --- 1. must be root -------------------------------------------------
if [ "$(id -u)" != "0" ]; then
  echo "Must run as root. Re-run as:  sudo sh fix-ssh.sh" >&2
  exit 1
fi

# --- start the log fresh, one run per file ------------------------------
echo "=== fix-ssh.sh run: $(date) ===" > "$LOG"

# --- 2. "before" state, for the record --------------------------------
# Logged BEFORE anything is touched — this is the evidence of why the
# box locked itself out, and it would be lost the moment we overwrite it.
{
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
} >> "$LOG" 2>&1

# --- 3. back up the old drop-in, if any --------------------------------
if [ -f "$DROPIN" ]; then
  BACKUP="/root/relay-443.conf.bak-$(date +%s)"
  cp "$DROPIN" "$BACKUP" >> "$LOG" 2>&1
  echo "backed up to $BACKUP" >> "$LOG"
fi

# --- 4. write the corrected drop-in -------------------------------------
# Explicit v4 AND v6 ListenStream lines (the blank ListenStream= first
# clears whatever the unit inherited), plus BindIPv6Only=both so a lone
# v6 line could never again silently exclude v4.
mkdir -p "$(dirname "$DROPIN")" >> "$LOG" 2>&1
cat > "$DROPIN" <<'EOF'
[Socket]
ListenStream=
ListenStream=0.0.0.0:22
ListenStream=0.0.0.0:443
ListenStream=[::]:22
ListenStream=[::]:443
BindIPv6Only=both
EOF
echo "wrote corrected $DROPIN" >> "$LOG"

# --- 5. reload and restart ------------------------------------------
systemctl daemon-reload >> "$LOG" 2>&1
systemctl restart ssh.socket >> "$LOG" 2>&1

# --- 6. verify, with automatic fallback ------------------------------
echo "=== AFTER ===" >> "$LOG"
AFTER="$(ss -lnt 2>/dev/null | grep -E ':(22|443)')"
echo "$AFTER" >> "$LOG"

case "$AFTER" in
  *0.0.0.0:22*)
    RESULT=ok
    ;;
  *)
    {
      echo "!!! FAILED: 0.0.0.0:22 still not listening after the corrected drop-in !!!"
      echo ">>> falling back: removing the drop-in so ssh.socket uses plain defaults <<<"
    } >> "$LOG"
    rm -f "$DROPIN" >> "$LOG" 2>&1
    systemctl daemon-reload >> "$LOG" 2>&1
    systemctl restart ssh.socket >> "$LOG" 2>&1
    AFTER="$(ss -lnt 2>/dev/null | grep -E ':(22|443)')"
    echo "=== AFTER FALLBACK ===" >> "$LOG"
    echo "$AFTER" >> "$LOG"
    case "$AFTER" in
      *0.0.0.0:22*) RESULT=ok_fallback ;;
      *)            RESULT=fail ;;
    esac
    ;;
esac

# --- 7. self-test IPv4 locally ----------------------------------------
# /dev/tcp is a bashism; dash (the usual /bin/sh) doesn't have it, so
# this only runs if bash is present, and its own if/else means a failure
# here can never abort the script (nothing above uses set -e either).
if command -v bash >/dev/null 2>&1; then
  if timeout 5 bash -c 'echo > /dev/tcp/127.0.0.1/22' 2>/dev/null; then
    SELFTEST=SELF_IPV4_OK
  else
    SELFTEST=SELF_IPV4_FAIL
  fi
else
  SELFTEST=SELF_IPV4_SKIP
fi
echo "$SELFTEST" >> "$LOG"

# --- 8. short status flags for the console summary -----------------------
case "$AFTER" in
  *0.0.0.0:22*)  IPV4_22=YES ;;
  *)             IPV4_22=NO ;;
esac
case "$AFTER" in
  *0.0.0.0:443*) IPV4_443=YES ;;
  *)             IPV4_443=NO ;;
esac

# --- 9. console summary — at most 4 short lines, everything else is above
# in LOG. Nothing else in this script writes to stdout/stderr on success.
case "$RESULT" in
  ok)          echo "SUCCESS" ;;
  ok_fallback) echo "SUCCESS-FALLBACK" ;;
  *)           echo "FAILED" ;;
esac
echo "ipv4 22:$IPV4_22 443:$IPV4_443"
echo "$SELFTEST"
echo "log: $LOG"
