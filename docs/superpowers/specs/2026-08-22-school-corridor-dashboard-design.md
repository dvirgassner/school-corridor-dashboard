# School Corridor Dashboard — Design

**Date:** 2026-08-22
**Status:** Draft for review
**Owner:** Dvir (remote maintainer) · School principal (content owner)

## 1. Purpose

Repurpose a Samsung 65S95B TV in a school corridor as an always-current
information screen showing, for the current day:

- Class schedule for each of the 6 grades
- Exams (subject, time, room)
- Special messages from the principal (normal / urgent), including occasional
  video clips

The principal edits content remotely with zero technical skill required.
Dvir can fix anything remotely. The system recovers from power cuts, Wi-Fi
drops, and crashes without anyone touching it.

Secondary goal: the project doubles as a learning vehicle for Dvir's
daughter — the repo, docs, and exercises are written to be readable by a
motivated 15-year-old.

## 2. Architecture

```
Principal (phone/PC)                    Dvir (anywhere)
      │ edits                                 │ Tailscale SSH
      ▼                                       ▼
Google Sheet ──publish-to-web CSV──►  Raspberry Pi 4 ──HDMI──► Samsung 65S95B
(schedule / exams / messages)         Chromium kiosk           (dumb display)
                                      showing dashboard page
                                      hosted on GitHub Pages
```

- **Dashboard page**: a single static HTML/CSS/JS page (Hebrew, RTL, dark
  theme, 1080p) hosted free on **GitHub Pages** from this repo. No server,
  no database, no build step.
- **Data source**: one **Google Sheet** with three tabs (Schedule, Exams,
  Messages), each *published to the web as CSV*. The page fetches the CSVs
  every 60 seconds and re-renders. No API keys, no backend.
- **Player**: **Raspberry Pi 4** (any RAM; used OK) running Raspberry Pi OS,
  auto-logging in and launching Chromium in kiosk mode at the dashboard URL.
- **TV**: acts as a dumb monitor on one HDMI input. Power schedule handled
  by the Pi via HDMI-CEC, with the TV's own on/off timers as backup.
- **Remote maintenance**: Tailscale on the Pi (outbound tunnel — works
  behind school NAT/firewall) giving Dvir SSH from anywhere.

### Why these choices (recorded for the record — details in docs/decisions.md)

- **Not Tizen-native**: consumer Samsung TVs cannot auto-start apps after a
  power cut, sideloaded apps break on firmware updates, and there is no
  remote access path into the TV. Every failure ends with a person and a
  remote control in the corridor.
- **Not ESP32**: no HDMI, no browser, three orders of magnitude too little
  RAM.
- **Google Sheet as backend**: the office already knows Sheets; editing from
  a phone works today; zero hosting, zero auth code, zero maintenance.
- **GitHub Pages as host**: free, effectively never down, versioned, and the
  repo doubles as the teaching artifact.

## 3. Data model — the Google Sheet

One spreadsheet, shared for editing with the principal (and office staff) via
their Google accounts. Three tabs. All text may be Hebrew.

### Tab `Schedule` — the weekly timetable grid

One row per (day, period). Columns:

| Day | Period | Start | End | ז׳ | ח׳ | ט׳ | י׳ | י"א | י"ב |
|-----|--------|-------|-----|----|----|----|----|-----|-----|
| א   | 1      | 08:00 | 08:45| מתמטיקה| אנגלית | ...| | | |

- `Day`: א–ו (Sunday–Friday, Israeli school week).
- **Grade columns are data-driven**: every column after `End` is a grade
  card, named by its header (currently ז׳–י"ב, i.e., the school's 6
  grades). Adding a 7th column (e.g., a grade split into ז׳1/ז׳2) makes the
  dashboard adapt automatically — see §4. The dashboard supports 6 or 7
  grade columns.
- Grade columns hold the subject (and optionally room, free-text).
- Empty cell = no class that period. The dashboard shows only *today's*
  column set, filtered by `Day`.

### Tab `Exams`

| Date | Grade | Subject | Start | End | Room |
|------|-------|---------|-------|-----|------|
| 2026-09-01 | ט׳ | מתמטיקה | 09:00 | 10:30 | חדר 12 |

- One grade per exam. `Grade` must match a Schedule column header.
- The dashboard shows only rows where `Date` = today.
- `Date` format: YYYY-MM-DD (the sheet column is formatted as date; the
  parser accepts DD/MM/YYYY as well, since Sheets in Hebrew locale defaults
  to it).

### Tab `Events`

| Date | Grades | Title | Start | End | Location |
|------|--------|-------|-------|-----|----------|
| 2026-09-01 | ז׳, ח׳ | חזרה כללית לטקס | 10:40 | 11:25 | אולם ספורט |

- `Grades`: one or more grade names, comma-separated, each matching a
  Schedule column header. On the dashboard, up to 3 grades render as
  per-grade color chips; 4 or more collapse to a neutral "כל השכבות" chip.
- Exams and events are **merged into one panel** ("אירועים ומבחנים היום"),
  sorted by `Start`.
- The panel physically fits ~6 entries in the 6-grade layout (~3 in the
  7-grade layout); later entries are dropped from display — the admin
  guide states this.

### Field length limits (enforced in the sheet)

Every free-text field gets a Google Sheets **data-validation rule**
(`=LEN(cell)<=N`, reject with help text) so content can never overflow its
box. Limits are derived from each element's pixel budget on the 1920×1080
canvas, using an average Hebrew glyph advance of ≈0.55×font-size (bold);
the dashboard additionally ellipsizes as a fallback.

| Field | Box budget | Font | Max chars |
|-------|-----------|------|-----------|
| Schedule: subject cell | ~281 px | 23 px | **20** |
| Exams: Subject | ~205 px (beside grade chip) | 26 px | **14** |
| Exams: Room | ~134 px (beside time) | 22 px | **12** |
| Events: Title | ~328 px (full row) | 26 px | **22** |
| Events: Location | ~134 px (beside time) | 22 px | **12** |
| Messages: normal Text | ~1435 px | 28 px | **90** |
| Messages: urgent Text | ~1438 px | 34 px | **75** |
| Grade column header | chip-sized | 21 px | **4** |

### Tab `Messages`

| Text | Type | VideoURL | From | Until | Active |
|------|------|----------|------|-------|--------|
| אסיפת הורים ביום שלישי | normal | | 2026-09-01 | 2026-09-03 | yes |
| | video | https://.../clip.mp4 | 2026-09-02 | 2026-09-02 | yes |

- `Type`: `normal` (rotating message strip), `urgent` (prominent banner,
  attention-styled), `video` (plays full-screen, muted by default; append
  `#sound` to the URL to opt into audio).
- `From`/`Until`: date range the item is shown (inclusive); empty = always.
- `Active`: `yes`/`no` — lets the principal stage or retire items without
  deleting rows.
- Video rule (documented in the admin guide): MP4, H.264, ≤1080p30, ≤50 MB,
  hosted at a direct-download URL (Dropbox "raw" link or similar). Clips
  play once per N minutes (default 10) while active, between which the
  normal dashboard shows.

### Data access

Each tab is *published to the web* as CSV (`File → Share → Publish to web`).
The page fetches the three CSV URLs with cache-busting query params.

**Privacy note (accepted):** published CSVs are readable by anyone holding
the URL. Content is a public corridor display — schedules, exams, and
announcements are by definition public within the school. No personal data
(student names, grades/marks) is ever put in this sheet; this rule goes in
the admin guide. Editing remains restricted to invited Google accounts.

## 4. Dashboard page

Single page in `dashboard/` (index.html + style.css + app.js + vendored
PapaParse for CSV parsing — the only dependency, committed to the repo).

### Layout (1920×1080, RTL)

```
┌──────────────────────────────────────────────────────────────┐
│  🕐 clock · Gregorian + Hebrew date       school name: תיכון השיטה│
├──────────┬──────────┬──────────┬─────────────────────────────┤
│ כיתה ז׳  │ כיתה ח׳  │ כיתה ט׳  │  אירועים ומבחנים היום       │
│ periods  │ periods  │ periods  │  (exams + events merged,    │
├──────────┼──────────┼──────────┤   sorted by start time)     │
│ כיתה י׳  │ כיתה י"א │ כיתה י"ב │  subject/title · time · room│
│ periods  │ periods  │ periods  │  grade chips per event      │
├──────────┴──────────┴──────────┴─────────────────────────────┤
│  rotating messages strip · "עודכן <date> · <time>" stamp     │
└──────────────────────────────────────────────────────────────┘
```

- Grade cards in a 2×3 grid (currently ז׳–י"ב); the *current period* row
  is highlighted based on the clock.
- **7-grade adaptation**: if the Schedule tab carries a 7th grade column,
  its card automatically takes the top-left cell (where the exams panel
  starts) and the exams panel shrinks to the bottom-left cell. No code
  change needed — the layout follows the sheet. (Preview: `?demo7`.)
- The header's Hebrew date renders with Hebrew numerals (gematria) — day
  and year in Hebrew letters (e.g., כ"ט באב תשפ"ו) via
  `Intl.DateTimeFormat("he-u-ca-hebrew-nu-hebr")`.
- The freshness stamp includes the date and time of the last successful
  data fetch: `עודכן DD.MM.YYYY · HH:MM`.
- Urgent message: full-width high-contrast banner under the header, cannot
  be missed. Multiple urgent messages rotate.
- Video: takes over the full screen for the clip's duration, then the
  dashboard returns.

### OLED burn-in protection (S95B is QD-OLED — mandatory)

- Dark background, mid-brightness text, no pure-white areas, no static logo.
- Entire layout shifts by a few pixels on a slow cycle (CSS transform,
  imperceptible to viewers).
- Accent colors on grade cards rotate daily.
- Screen is OFF outside school hours (see §6), letting the TV run its panel
  care cycle in standby.

### Behavior & error handling

- Fetch all three CSVs every 60 s. On success: render + persist to
  `localStorage` + update the "עודכן HH:MM" stamp.
- On fetch failure (Wi-Fi/Google down): keep rendering the last good data
  from `localStorage`; the stamp goes amber after 10 minutes of staleness.
  The corridor never sees an error page.
- Malformed rows (bad date, empty required field) are skipped individually —
  one typo in the sheet never blanks the board.
- Day rollover: the page re-filters by date on every render tick, so at
  midnight it naturally becomes "tomorrow's board" (screen is off then
  anyway).
- Clock is the Pi's system clock (NTP-synced).

## 5. Raspberry Pi setup

Target: Pi 4 (any RAM), Raspberry Pi OS 64-bit (Bookworm) with desktop,
brand-name SD card, official PSU. All steps scripted in `pi/setup.sh` and
documented step-by-step in `pi/README.md` (the teaching walk-through).

- **Kiosk**: autologin to the desktop session; a systemd user service
  launches Chromium with `--kiosk --noerrdialogs --disable-infobars
  --incognito <dashboard URL>` at 1920×1080 output. Screen blanking and the
  mouse cursor disabled.
- **Watchdog**: the systemd service has `Restart=always` — Chromium crash =
  auto-relaunch in seconds. A cron `@daily` reboot at 03:00 clears any slow
  leak.
- **Power/display schedule** (cron + `cec-ctl`; hours confirmed 2026-08-22):
  - School days 07:00 — CEC "image view on" (wakes the TV from standby)
  - Sun–Thu 17:00, Fri 15:00 — CEC "standby"
  - The TV's own On/Off timers are configured identically as a belt-and-
    suspenders backup. Overnight the TV sits in standby (not mains-off), so
    its nightly OLED panel-care cycle still runs.
- **Remote access**: Tailscale with SSH enabled; the Pi appears on Dvir's
  tailnet from anywhere. No inbound ports needed on the school network.
- **Heartbeat**: cron curls a free healthchecks.io check every 10 min; Dvir
  gets an email if the Pi goes silent for an hour.
- **Resilience**: `fsck` on boot enabled; journald capped; nothing on the Pi
  is state — a spare flashed SD card in the drawer is the full disaster
  recovery plan (documented).

## 6. TV (Samsung S95B) configuration checklist

Captured in `docs/tv-setup.md`:

- Anynet+ (HDMI-CEC): **on** — lets the Pi drive power.
- On/Off timers: mirror the cron schedule (backup path).
- Eco solution / Energy saving / motion lighting: **off** (they dim or kill
  the picture).
- Auto Power Off / sleep timer: **off**.
- Picture: Filmmaker or Standard, brightness moderate (corridor-legible but
  OLED-kind), all dynamic/vivid processing off.
- Source: the Pi's HDMI input selected; "Auto Source Switching+" on so the
  TV lands on the Pi after power events.
- Panel care: leave defaults (runs in standby).
- Network: TV itself needs no Wi-Fi (optional: connect once for firmware,
  then forget) — the Pi is the only networked device. Fewer moving parts.
- Physical: remote stored in the office; Pi velcro'd behind the TV with its
  own PSU on a surge-protected socket **not** switched off at night.

## 7. Security & access summary

| Who | Access | Mechanism |
|-----|--------|-----------|
| Principal / office | Edit content | Google Sheet sharing (their Google accounts) |
| Anyone in corridor | View board | The TV |
| Anyone with CSV URL | Read content (no PII by policy) | Published CSV |
| Dvir | Full remote admin of Pi | Tailscale SSH |
| Daughter | Read/modify code, hands-on Pi work | GitHub repo (own GitHub account), supervised sessions |

No custom auth code anywhere — that's deliberate: authentication is
delegated entirely to Google (sheet) and Tailscale (Pi).

## 8. Repository layout (teaching-oriented)

```
school-corridor-dashboard/
├── README.md                  # project intro, written teen-readable
├── dashboard/                 # the web page (index.html, style.css, app.js,
│                              #   vendor/papaparse.min.js) — GitHub Pages root
├── pi/                        # setup.sh, kiosk service, cron files, README
│                              #   walk-through (flash → boot → kiosk)
├── docs/
│   ├── superpowers/specs/     # this design doc
│   ├── decisions.md           # why not ESP32 / Tizen / SaaS — the "why" record
│   ├── admin-guide.md         # 1-pager for the principal (Hebrew): how to edit
│   │                          #   the sheet, message rules, video rules, no-PII rule
│   ├── tv-setup.md            # §6 as a checklist
│   └── exercises.md           # "try changing this" tasks for the daughter
└── .github/                   # (nothing needed — Pages serves from branch)
```

## 9. Testing plan

1. **Bench phase (at home, before school deployment):** full stack against
   the actual S95B — power-cut test (pull the plug: Pi must return to the
   dashboard unattended), Wi-Fi-drop test (board keeps last data, stamp goes
   amber), sheet-vandalism test (garbage rows don't blank the board),
   video test (clip plays and returns), CEC schedule test overnight.
2. **Content dry run:** principal edits the real sheet from their phone;
   change appears on the bench TV within 60 s.
3. **Deployment:** install at school, re-run power-cut test on site, confirm
   Tailscale reachability from outside the school network.
4. Only after all of the above: hand the remote to the office.

## 10. Out of scope (YAGNI, revisit only if asked)

- User accounts / roles beyond Google Sheet sharing
- A custom admin web app (the Sheet *is* the admin app)
- Multi-screen support, weather widgets, RSS feeds
- Serving video from the Pi's local storage (only if remote MP4 links prove
  unreliable in practice)
- 4K rendering (1080p upscaled is indistinguishable at corridor distance)

## 11. Cost summary

| Item | Cost |
|------|------|
| Used Pi 4 (or 3B+ fallback) | ~$25–45 |
| New brand-name SD card ×2 (one spare) | ~$16 |
| Official PSU, case, HDMI cable | ~$20 |
| Hosting (GitHub Pages), backend (Google Sheets), Tailscale, healthchecks.io | $0 |
| **Total, one-time** | **~$60–80** |
