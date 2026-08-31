# Setting up the Raspberry Pi

This is the walk-through for turning a Raspberry Pi into the corridor
board player. If you have never used a Pi before, you can follow this
top to bottom — nothing here assumes prior Linux experience.

**What you need**

- A Raspberry Pi 4 (any RAM size; a used Pi 3B+ also works)
- A **new, brand-name** microSD card, 16–32 GB (cheap no-name cards are
  the number-one cause of dead Pi installations — this is not the place
  to save $3)
- The official power supply (an underpowered charger causes random
  freezes that look like software bugs for weeks)
- An HDMI cable, and a keyboard for the first ten minutes

## 1. Flash the card

1. Install **Raspberry Pi Imager** on your PC: <https://www.raspberrypi.com/software/>
2. Choose **Raspberry Pi OS (64-bit)** — the full desktop version, not Lite.
   (The board runs in a browser, and the browser needs a desktop.)
3. Click the **gear / "Edit settings"** button *before* writing, and set:
   - hostname: `board`
   - username and password (remember these)
   - **Wi-Fi**: the school's network name and password
   - **Enable SSH** (password authentication is fine for now)
4. Write the card, put it in the Pi, connect HDMI to the TV, and power up.

Presetting Wi-Fi and SSH here means the Pi joins the network on its very
first boot, and you never need a keyboard again after the next step.

## 2. First boot

Let it finish the first-boot resize and reach the desktop. Then open a
terminal (or SSH in from your PC with `ssh board@board.local`) and run:

```bash
sudo raspi-config
```

Set **System Options → Boot / Auto Login → Desktop Autologin**. This is
the piece that makes the board come back by itself after a power cut:
the Pi boots, logs in on its own, and the autostart entry launches the
browser.

(`pi/setup.sh` sets the timezone to `Asia/Jerusalem` and turns on network
time sync for you, so you do not need to do it here. Daylight saving is
handled automatically from the timezone database — there is nothing to
adjust twice a year.)

## 3. Install the board

```bash
sudo apt install -y git
git clone https://github.com/<your-user>/<your-repo>.git
cd <your-repo>
DASH_URL="https://<your-user>.github.io/<your-repo>/dashboard/#t=<TOKEN>&g=<gid>,<gid>,<gid>,<gid>" \
  bash pi/setup.sh
```

**The `#t=…&g=…` part is what points the board at the school's Google
Sheet, and this Pi is the only place it exists.** It is deliberately not
in the repository, so the repository can be public without exposing the
sheet. Get the token and the four gids (מערכת, מבחנים, אירועים, הודעות —
in that order) from
[`../sheet-template/README.md`](../sheet-template/README.md).

Without the fragment the board still runs, but shows **demo data** — a
useful way to test the Pi before the sheet exists.

If you set up a free <https://healthchecks.io> check (recommended — it
emails you if the Pi goes silent), add its ping URL:

```bash
DASH_URL="https://…/dashboard/#t=…&g=…" HEALTHCHECK_URL="https://hc-ping.com/xxxx" \
  bash pi/setup.sh
```

The script installs Chromium and `cec-utils`, writes `~/kiosk.sh` and
`~/start-board.sh`, registers autostart for whichever desktop
compositor your Pi release uses, and installs the cron jobs for the
screen schedule (on 07:00; off 17:00 Sun–Thu, 15:00 Fri, all Saturday),
the heartbeat ping, and a 03:00 nightly reboot.

## 4. Remote access (so you never have to drive to the school)

Try Tailscale first — it is by far the least work:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
```

It makes an **outbound** connection, so it normally works from behind a
school firewall and NAT with no open ports and no help from IT.

### If the network blocks it

Some school filters terminate TLS by SNI, which kills Tailscale *and*
Cloudflare Tunnel — both fail with `tls: handshake failure` while
ordinary browsing works. That is what happened on the deployment this
repo describes.

**SSH on port 443 still passes**, because SSH sends no SNI for a filter
to match. So the fallback is a reverse-SSH tunnel to any cheap VPS:

```bash
sudo pi/relay-setup.sh              # autossh + board-relay.service
sudo pi/relay-verify.sh             # installs sshd if absent, checks the path out
```

`relay-setup.sh` prints the Pi's public key. Put it on the VPS in the
`relay` user's `authorized_keys` with `restrict,port-forwarding`, give
the VPS an sshd listening on 443, and point a DNS A record at it. The Pi
then dials in every 30 seconds until it succeeds, and you reach it with:

```bash
ssh -o ProxyCommand="ssh -i ~/.ssh/<vps-key> -W %h:%p -p 443 <vpsuser>@<vps>" \
    -i ~/.ssh/<pi-key> -p 2222 <piuser>@localhost
```

Two hops, each needing its **own** key — a bare `ssh -J relay@…` fails,
because the `relay` account holds only the Pi's key and is restricted to
port forwarding.

On Ubuntu 24.04, "give the VPS an sshd listening on 443" means a systemd
drop-in, since `ssh.socket` ignores `sshd_config`'s `Port`:

```ini
# /etc/systemd/system/ssh.socket.d/relay-443.conf
[Socket]
ListenStream=0.0.0.0:443
ListenStream=[::]:443
```

Add 443 without resetting `ListenStream=` first. **Warning:** an empty
`ListenStream=` clears the listen-address list but **not**
`BindIPv6Only`, which the stock unit sets to `ipv6-only` — so bare port
numbers written after a reset silently become IPv6-only and IPv4 access
disappears with no error anywhere, `ss -lnt` included. See
`docs/decisions.md`.

Expect school DNS to take several minutes to see a brand-new record. If
the tunnel does not appear at once, check `ss -lnt | grep 2222` on the
VPS before suspecting the Pi.

## 5. Reboot and test the things that matter

```bash
sudo reboot
```

Then check, in this order:

1. **Does the board appear on its own?** No keyboard, no clicking.
2. **Pull the power plug**, wait ten seconds, plug it back in. The board
   must come back unattended. This is the single most important test —
   it is exactly what a power cut at the school looks like.
3. **Disconnect the network** (or `sudo ip link set wlan0 down`). The
   board must keep showing the last data with the "עודכן" stamp turning
   amber, never a browser error page. Re-enable and confirm it recovers.
4. **Edit the Google Sheet** from your phone; the change must appear on
   the board within a minute.
5. **Leave it running overnight** and confirm the CEC schedule turns the
   TV off and on.

## The TV schedule, and the CEC trap

`setup.sh` installs cron jobs that switch the TV on at 07:00 and to
standby in the afternoon, over HDMI-CEC. It also pins the HDMI mode with
`video=HDMI-A-1:1920x1080@60D`, so the Pi boots with a picture even when
the TV is asleep.

**Those two things fight each other.** A forced connector skips the
driver's `detect()`, which is where CEC reads its physical address from
the EDID. Without it:

```
Physical Address : f.f.f.f
cec-client       : ioctl CEC_TRANSMIT failed, errno=64 (ENONET)
```

Every CEC command fails, and because the cron jobs discard their output
it fails **silently** — on the original board, for weeks, with the TV
schedule never once working.

`pi/cec-fix.sh` resolves it: boot forced, then un-force 60 s later via
`board-hdmi-cec.service`, which restores CEC. `setup.sh` runs it for you.
On an existing board, run it on its own:

```bash
sudo pi/cec-fix.sh
cec-ctl -d /dev/cec0 | grep -i "Physical Address"   # want 1.0.0.0
echo "pow 0" | cec-client -s -d 1 | grep "power status"
```

Un-forcing is safe with the TV asleep: a set in **standby still asserts
hotplug and still answers EDID**. If the display genuinely is absent, the
script puts the force straight back.

### Knowing remotely whether the TV is on

`/sys` cannot tell you. A TV in standby reports `status=connected` with a
full 256-byte EDID while CEC simultaneously reports `standby`. Only CEC
knows.

Set `TV_HEALTHCHECK_URL` (a **second** healthchecks.io check, separate
from the Pi's own heartbeat) and `setup.sh` installs `pi/tv-probe.sh` on
a 10-minute cron. It fails loudly when the TV is off during school hours
or the HDMI connector disappears, pings OK when standby is expected, and
stays silent when it cannot get an answer — so a single flaky CEC reply
never raises an alert.

## Everyday maintenance

| Task | Command |
|---|---|
| **See what the TV is showing** | from your PC: `ssh dvir@kit '~/screenshot.sh' > board.png` |
| Check exactly one board is running | `pgrep -c -f kiosk.sh` — must be **1** |
| Read the kiosk log | `tail -30 ~/kiosk.log` |
| See the board's log | `journalctl --user -f` or run `~/kiosk.sh` in a terminal |
| **Get to the desktop** | `~/board.sh stop` — then `~/board.sh start` to return |
| Restart the board | `~/board.sh restart` |
| What is running | `~/board.sh status` |
| Change the board URL or sheet token | edit `~/.dashboard-env`, then `sudo reboot` |
| Update the dashboard code | `cd <repo> && git pull` (only if you self-host; with GitHub Pages the Pi just reloads the page) |
| Force the TV on/off now | `echo "on 0" \| cec-client -s -d 1` / `echo "standby 0" \| cec-client -s -d 1` |

## Checking the screen from home

`~/screenshot.sh` captures the live display and writes a PNG to standard
output, so one command from your own machine both takes and fetches it:

```bash
ssh dvir@kit '~/screenshot.sh' > board.png
```

Nothing is written to the Pi's SD card — that card is the part most
likely to wear out, so keeping routine checks off it matters.

It detects the session type rather than assuming: `grim` on Wayland
(Raspberry Pi OS Bookworm and later) or `scrot` on X11. Run it as the
**same user** the kiosk runs as; another user cannot reach that display.

This proves what the panel is actually being sent, which is strictly more
than the heartbeat ping tells you — a Pi with a dead HDMI cable pings
perfectly happily.

## If the board seems to reload every few seconds

That is almost never the page reloading. It is Chromium exiting and the
watchdog restarting it, and the usual cause is **two instances running at
once** — two autostart entries, or a manual launch alongside the
autostarted one. Two Chromium instances sharing one profile corrupt each
other's state, and the log fills with:

```
Failed to open UKM database: database is locked
```

Check with `pgrep -c -f kiosk.sh` (must be 1). Note that
`pgrep -f start-board.sh` always returns 0 — that script `exec`s the
kiosk loop, replacing itself, so it never appears in the process list.

Re-running `pi/setup.sh` registers exactly one autostart entry and deletes
any duplicate it finds.

## Never run a second Chromium on the Pi

Launching `chromium` manually over SSH competes for the kiosk's single
profile directory. Both instances then corrupt each other's state, and when
the manual one exits, both crash at once — live board down. The second
crash is often preceded by a **gnome-keyring password dialog on the TV
screen** — an unanswerable modal that freezes the display. Recovery comes
only when the watchdog restarts it 4–5 seconds later, but this is
self-inflicted downtime on a school wall display.

**Always use a separate profile.** Keep checks short and rare on a 1GB Pi
that already runs in swap. Prefer `--headless` for content inspection:

```bash
chromium --user-data-dir=/tmp/check --headless --screenshot --dump-dom <url>
```

## If something breaks

The Pi holds no irreplaceable state. Keep a **second SD card flashed
and configured** in a drawer at the school: if the card dies (the most
likely hardware failure), someone swaps it and the board is back in two
minutes without you.

## How code updates reach the board

The board re-reads the **sheet** every minute, but its own HTML, CSS and
JavaScript are whatever Chromium loaded when it started. So a pushed fix
used to sit unseen until the 03:00 reboot — which is why a screen could
show an old version number for a day.

Since v0.164 the page checks `config.js` every 15 minutes and reloads
itself when the `version` string changes. Nothing to do: publish, and the
screens pick it up within a quarter of an hour.

To force it immediately:

```bash
ssh dvir@kit 'pkill chromium'
```

The watchdog relaunches it within five seconds with the current build.

## Getting to the desktop

### Standing at the TV, no SSH (the case that matters)

If the network is down, Tailscale is unreachable or the Pi is on the
wrong Wi-Fi, every remote instruction is useless — and the kiosk covers
the whole screen. Two ways out, using only a keyboard plugged into the
Pi:

**1. Keyboard shortcut** (registered by `pi/setup.sh`):

| Keys | What happens |
|---|---|
| **Ctrl + Alt + B** | board stops — the desktop appears |
| **Ctrl + Alt + N** | board starts again |

**2. Text console** — works on any Linux, needs no configuration, and is
the fallback if the shortcut was not registered for your compositor:

1. **Ctrl + Alt + F2** — a plain login prompt appears
2. Log in as `dvir` with the Pi's password
3. `~/board.sh stop`
4. **Ctrl + Alt + F1** (or F7) — back to the desktop, now usable

To bring the board back: `~/board.sh start`, or just reboot. There is no
way to leave it off permanently by accident.

### Over SSH

The kiosk is a watchdog loop that relaunches the browser within five
seconds, so closing Chromium on its own just makes it blink. Stop the
loop first:

```bash
~/board.sh stop      # browser closed, no relaunch — the desktop is yours
~/board.sh start     # put the board back
~/board.sh status    # what is running right now
```

A reboot also restores the board, so there is no way to leave it
accidentally switched off for good.
