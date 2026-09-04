# TV settings — Samsung 65S95B

Do this once, with the remote, after the Pi is connected and showing the
board. Then put the remote in the office drawer.

The TV's only job here is to be a monitor. Everything on this list either
stops the TV from interfering, or protects the panel.

## Connection

- [ ] Plug the Pi into an HDMI port and note which one (e.g. HDMI 2).
- [ ] Give the Pi **its own power supply** — never the TV's USB port,
      which cuts power in standby and would leave the Pi dead every
      morning.
- [ ] The Pi's power should be on a socket that is **not** switched off
      at night.
- [ ] The TV itself needs no network connection. Leave it off Wi-Fi
      (connect once for a firmware update if you want, then forget the
      network). One networked device is one thing that can break.

## Settings to change

| Setting | Where | Value | Why |
|---|---|---|---|
| Anynet+ (HDMI-CEC) | General & Privacy → External Device Manager | **On** | lets the Pi turn the TV on and off on schedule |
| Auto Source Switching+ | External Device Manager | **On** | the TV lands on the Pi after power events |
| Sleep timer / Auto power off | General → Power and Energy Saving | **Off** | otherwise the board disappears mid-day |
| Screen saver | General → Power and Energy Saving | **Off** | it would cover the board |
| Brightness Optimization / Ambient light detection | Power and Energy Saving | **Off** | it dims the board unpredictably |
| Brightness Reduction | Power and Energy Saving | **Off** | same |
| Picture mode | Picture | **Filmmaker** or **Standard** | no dynamic processing fighting a static page |
| Brightness | Picture → Expert Settings | **moderate** (~60–70%) | legible down a corridor without cooking the OLED |
| Motion smoothing / Auto Motion Plus | Expert Settings | **Off** | pointless on a static page |
| Pixel Shift | Expert Settings → Panel Care | **On** | extra burn-in insurance beneath our own drift |
| Input label | Source menu | name it "Board" | so nobody unplugs the "unknown" device |

## Leave these alone

- **Panel Care / Pixel Refresh** — runs automatically in standby. This is
  why the nightly schedule puts the TV in *standby* rather than cutting
  mains power.
- Any picture calibration. The board is designed for a plain, honest
  picture mode.

## The schedule

The Pi drives this over HDMI-CEC (see `pi/cron` entries installed by
`pi/setup.sh`):

| When | What |
|---|---|
| Sun–Fri 07:00 | TV on |
| Sun–Thu 18:00 | TV to standby |
| Fri 14:00 | TV to standby |
| Saturday | stays off |

As a backup, set the TV's **own On/Off timers** to the same hours
(General → System Manager → Time → On/Off Timer): on 07:00 Sun-Fri, off
18:00 Sun-Thu, off 14:00 Fri. If CEC ever fails, the TV still follows the
schedule on its own.

**Do set those timers.** CEC is fragile here: pinning the HDMI mode (which
the Pi does so it boots with a picture) disables CEC outright unless
`pi/cec-fix.sh` is installed, and the failure is silent because the cron
jobs discard their output. The TV's own timer is the one mechanism that
does not depend on the Pi at all.

Anynet+ (HDMI-CEC) must be ON for any of this: General → External Device
Manager → Anynet+ (HDMI-CEC).

### The Auto Power Off trap

This is a **separate setting** from the On/Off Timer above, and it is not
covered by turning that timer off.

Samsung's Eco Solution puts the TV into standby after it gets no *remote
control* input for a few hours — regardless of what is on screen, and
regardless of the On/Off Timer schedule. A CEC power-on does **not** count
as input and does not reset this timer, so a set woken by the Pi still
drops itself back into standby mid-morning.

Detected 2026-08-30: the Pi's cron woke the TV at 07:00 as scheduled, and
the TV probe still found it in standby at 11:10 on a school day (`TV is
'standby' during school hours (Sun 11:10)`), with CEC itself perfectly
healthy throughout. The board had likely been going dark most mornings
since installation — nothing looked wrong until the probe caught it.

Turn it off, with the remote, at the set:

- Older firmware: **General → Eco Solution → Auto Power Off**
- Newer firmware: **General → Power and Energy Saving → Auto Power Off**

(the menu was renamed between firmware years; check both paths.)

Disabling this is the real fix. Until someone is at the TV to do it, the
Pi's cron re-sends `on 0` every 30 minutes through the school day as a
remote-only workaround — it defeats the idle timer but does nothing to
the setting itself.

To check CEC is alive from the Pi:

```bash
cec-ctl -d /dev/cec0 | grep -i "Physical Address"   # f.f.f.f means broken
echo "pow 0" | cec-client -s -d 1 | grep "power status"
```

## Burn-in: what the board already does

The S95B is a QD-OLED, and a static dashboard is the worst-case content
for it. The design compensates:

- dark background, no pure-white fields, softened off-white text
- the whole layout drifts a few pixels on a slow cycle
- the screen is off ~14 hours a day and all weekend
- classes that have passed disappear, so the pixel pattern keeps changing
  through the day
- video clips (moving pixels) are actively good for the panel

## Physical

- [ ] Mount the Pi behind the TV (velcro or double-sided tape), cables
      dressed so nothing dangles.
- [ ] Remote control stored in the office, not near the TV.
- [ ] Note the Pi's Tailscale name in the office folder, plus who to
      call. A spare flashed SD card in the same drawer turns a dead card
      into a two-minute fix by a non-technical person.
