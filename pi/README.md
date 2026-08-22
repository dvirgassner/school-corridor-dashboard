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

While you are there, under **Localisation Options**, set the timezone to
`Asia/Jerusalem` — the board's clock and "today" logic follow the Pi's
system time.

## 3. Install the board

```bash
sudo apt install -y git
git clone https://github.com/<your-user>/<your-repo>.git
cd <your-repo>
DASH_URL="https://<your-user>.github.io/<your-repo>/dashboard/" bash pi/setup.sh
```

If you set up a free <https://healthchecks.io> check (recommended — it
emails you if the Pi goes silent), add its ping URL:

```bash
DASH_URL="https://…/dashboard/" HEALTHCHECK_URL="https://hc-ping.com/xxxx" bash pi/setup.sh
```

The script installs Chromium and `cec-utils`, writes `~/kiosk.sh` and
`~/start-board.sh`, registers autostart for whichever desktop
compositor your Pi release uses, and installs the cron jobs for the
screen schedule (on 07:00; off 17:00 Sun–Thu, 15:00 Fri, all Saturday),
the heartbeat ping, and a 03:00 nightly reboot.

## 4. Remote access (so you never have to drive to the school)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
```

Sign in with the link it prints. Tailscale makes an **outbound**
connection, so it works from behind the school's firewall and NAT with
no help from the school's IT department and no open ports. After this
you can `ssh board` from anywhere on your own tailnet.

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

## Everyday maintenance

| Task | Command |
|---|---|
| See the board's log | `journalctl --user -f` or run `~/kiosk.sh` in a terminal |
| Restart just the browser | `pkill chromium` (the loop relaunches it) |
| Change the board URL | edit `~/.dashboard-env`, then `sudo reboot` |
| Update the dashboard code | `cd <repo> && git pull` (only if you self-host; with GitHub Pages the Pi just reloads the page) |
| Force the TV on/off now | `echo "on 0" \| cec-client -s -d 1` / `echo "standby 0" \| cec-client -s -d 1` |

## If something breaks

The Pi holds no irreplaceable state. Keep a **second SD card flashed
and configured** in a drawer at the school: if the card dies (the most
likely hardware failure), someone swaps it and the board is back in two
minutes without you.
