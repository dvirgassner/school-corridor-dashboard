#!/bin/sh
# tv-probe.sh — is the TV actually ON when it is supposed to be?
#
# Installed by setup.sh as a cron job every 10 minutes, but only when
# TV_HEALTHCHECK_URL is set in ~/.dashboard-env. Reports to a healthchecks
# check SEPARATE from the Pi's own heartbeat, so "the Pi died" and "the TV
# died" arrive as different alerts.
#
# ---------------------------------------------------------------------
# WHY NOT JUST READ /sys
#
# Because it cannot answer the question. A TV in standby still reports
#
#     status=connected   edid=256 bytes
#
# while CEC simultaneously reports "standby". Measured on a Samsung
# 65S95B. The connector state only tells you the cable is in and the set
# has mains power — useful, but not the same question.
#
# So the connector answers "is the screen physically there" and CEC
# answers "is it awake". Both are checked, because they fail differently:
# a pulled cable and a switched-off TV need different people to fix them.
#
# cec-client, not cec-ctl: cec-ctl refuses to talk until the adapter has
# been configured, while cec-client configures itself. Verified that its
# power query does NOT wake a TV that is in standby.
# ---------------------------------------------------------------------
. "$HOME/.dashboard-env" 2>/dev/null || true
URL="$TV_HEALTHCHECK_URL"
[ -n "$URL" ] || exit 0

CONN=$(ls -d /sys/class/drm/card*-HDMI-A-1 2>/dev/null | head -1)
[ -n "$CONN" ] || exit 0

DOW=$(date +%w)                 # 0=Sunday .. 6=Saturday
HHMM=$(date +%H%M)
# The leading 1 is not decoration. The shell reads 08 and 09 as octal and
# aborts on them, so without this every probe between 08:00 and 09:59
# would die silently — squarely inside school hours, the only time this
# script matters at all.
MIN=$(( (1${HHMM%??} - 100) * 60 + 1${HHMM#??} - 100 ))

# Must match the on/standby cron jobs in setup.sh.
EXPECT=off
case "$DOW" in
  0|1|2|3|4) [ "$MIN" -ge 420 ] && [ "$MIN" -lt 1080 ] && EXPECT=on ;;  # Sun-Thu 07:00-18:00
  5)         [ "$MIN" -ge 420 ] && [ "$MIN" -lt  840 ] && EXPECT=on ;;  # Fri     07:00-14:00
esac

STATUS=$(cat "$CONN/status" 2>/dev/null)
EDID=$(wc -c < "$CONN/edid" 2>/dev/null || echo 0)

# A missing screen matters whatever the hour, so this is checked first.
if [ "$STATUS" != "connected" ] || [ "$EDID" -lt 128 ]; then
  curl -fsS -m 15 --data-raw \
    "HDMI gone: status=$STATUS edid=$EDID bytes. Cable out, or the TV lost mains power." \
    "$URL/fail" >/dev/null 2>&1
  exit 0
fi

POWER=$(echo "pow 0" | timeout 25 cec-client -s -d 1 2>/dev/null \
        | sed -n 's/.*power status: *//p' | head -1)

# Could not ask. Deliberately ping NOTHING rather than guess: the check's
# own grace period then escalates only if it keeps happening, so one
# flaky CEC reply does not raise an alert at 3am.
[ -n "$POWER" ] || exit 0

if [ "$EXPECT" = on ] && [ "$POWER" != "on" ]; then
  curl -fsS -m 15 --data-raw \
    "TV is '$POWER' during school hours ($(date '+%a %H:%M')). Switched off by hand, or the 07:00 CEC wake failed." \
    "$URL/fail" >/dev/null 2>&1
  exit 0
fi

curl -fsS -m 15 --data-raw \
  "TV $POWER, expected $EXPECT ($(date '+%a %H:%M'))" "$URL" >/dev/null 2>&1
