#!/bin/sh
# cec-fix.sh — make HDMI-CEC work on a board that pins its HDMI mode.
#
# Run once, as root:  sudo pi/cec-fix.sh
# Idempotent. setup.sh calls this for you; it is separate so it can be
# re-run on an existing board without re-running everything else.
#
# ---------------------------------------------------------------------
# THE PROBLEM
#
# setup.sh adds `video=HDMI-A-1:1920x1080@60D` to cmdline.txt so the Pi
# boots with a picture even when the TV is in standby and answering
# nothing. Without it a reboot while the TV is off leaves wlroots with a
# headless output and Chromium sized to nothing.
#
# The trailing D forces the connector "connected" — and a forced
# connector SKIPS the driver's detect() path. detect() is exactly where
# the CEC physical address is read out of the EDID. So the fix for the
# blank-screen problem silently disables CEC:
#
#     Physical Address : f.f.f.f      (invalid)
#     cec-client       : ioctl CEC_TRANSMIT failed, errno=64 (ENONET)
#
# Every CEC command fails. The TV on/off cron jobs installed by setup.sh
# redirect to /dev/null, so they fail silently — on the board this was
# found on, for weeks, with nobody aware the schedule had never worked.
#
# The vc4 driver REFUSES a manually supplied physical address
# ("The CEC adapter doesn't allow setting the physical address manually"),
# so re-detecting is the only route back.
#
# THE FIX
#
# Boot forced, then un-force once the system is up. Both properties are
# kept: the headless-boot protection during boot, working CEC afterwards.
#
# Safe when the TV is off, because a TV in STANDBY still asserts hotplug
# and still answers EDID — measured, not assumed. And if the display
# genuinely is not there, the script re-forces immediately, leaving
# exactly the old behaviour.
# ---------------------------------------------------------------------
set -e
[ "$(id -u)" = 0 ] || { echo "run me with sudo" >&2; exit 1; }

install -m 0755 /dev/stdin /usr/local/sbin/board-hdmi-cec.sh <<'SCRIPT'
#!/bin/sh
# Un-force the HDMI connector so the driver re-detects it, which is what
# hands CEC its physical address. See pi/cec-fix.sh for why this exists.
CONN=$(ls -d /sys/class/drm/card*-HDMI-A-1 2>/dev/null | head -1)
log() { logger -t board-hdmi-cec "$1"; echo "$1"; }

[ -n "$CONN" ] || { log "no HDMI-A-1 connector found"; exit 0; }

echo detect > "$CONN/status"
sleep 4

STATUS=$(cat "$CONN/status")
EDID=$(wc -c < "$CONN/edid")

# A real display answers with an EDID. If this one does not, put the
# force back rather than leaving a wall-mounted screen dark.
if [ "$STATUS" != "connected" ] || [ "$EDID" -lt 128 ]; then
  echo on > "$CONN/status"
  log "no display after re-detect (status=$STATUS edid=$EDID) - force restored"
  exit 0
fi

PA=$(cec-ctl -d /dev/cec0 2>/dev/null | grep -i 'Physical Address' | awk '{print $NF}')
log "re-detected: status=$STATUS edid=$EDID cec=$PA"
[ "$PA" = "f.f.f.f" ] && log "WARNING: CEC still has no address; the TV schedule will not work"
exit 0
SCRIPT

cat > /etc/systemd/system/board-hdmi-cec.service <<'UNIT'
[Unit]
Description=Re-detect HDMI after boot so CEC gets its physical address
After=multi-user.target

[Service]
Type=oneshot
# The compositor needs its display first. Un-forcing before the session
# has settled risks a black screen on a wall nobody can reach quickly.
ExecStartPre=/bin/sleep 60
ExecStart=/usr/local/sbin/board-hdmi-cec.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable board-hdmi-cec.service >/dev/null 2>&1

echo "installed board-hdmi-cec.service (runs 60s after every boot)"

# Apply it now too, so CEC works without waiting for a reboot.
/usr/local/sbin/board-hdmi-cec.sh

cat <<'NOTE'

Verify with:
    cec-ctl -d /dev/cec0 | grep -i "Physical Address"     # want 1.0.0.0, not f.f.f.f
    echo "pow 0" | cec-client -s -d 1 | grep "power status"

"power status" answering at all means the TV schedule will now work.
NOTE
