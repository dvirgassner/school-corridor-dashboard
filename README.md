# לוח מסדרון — School Corridor Dashboard

An information board for a school corridor: today's timetable for every
grade, today's exams and events, and messages from the principal. It runs
on a 65" TV in the hallway, updates itself from a Google Sheet, and needs
nobody standing next to it.

```
Principal (phone)                          You (anywhere)
     │ edits                                    │ Tailscale SSH
     ▼                                          ▼
Google Sheet ──── CSV ────►  Raspberry Pi ──HDMI──►  Samsung TV
(5 tabs)                     Chromium kiosk           (dumb screen)
                             showing this page
                             hosted on GitHub Pages
```

## How it actually works

There is no server and no database anywhere in this project. That is the
whole design idea:

- **The Google Sheet is the admin app.** The principal edits five tabs —
  timetable, exams, events, messages and one settings tab that switches
  the board's colour theme — from a phone. Google handles the accounts
  and the permissions.
- **The dashboard is one static web page.** It reads the sheet as CSV
  feeds every 60 seconds and redraws itself. GitHub Pages hosts it for
  free and never goes down.
- **The sheet's address is not in this repository.** The Pi passes it in
  the URL fragment, which browsers never send to the server — so this
  repo stays public while the school's data stays unlisted. Opening the
  public URL shows demo data. See
  [`sheet-template/README.md`](sheet-template/README.md).
- **The Raspberry Pi is a browser on a stick.** It boots, logs in, opens
  the page full-screen, and relaunches the browser if it ever dies.
- **The TV is just a monitor.** The Pi turns it on and off over the HDMI
  cable (HDMI-CEC) on the school's schedule.

Because every piece is replaceable and nothing holds state, there is
very little that can break — and anything that does break can be fixed
remotely.

## Try it right now

Open [`dashboard/index.html`](dashboard/index.html) in any browser. With
no sheet configured it runs in **demo mode** with built-in sample data
and the clock pinned to 08:10, so you see a full school day.

Useful URL parameters:

| Parameter | What it does |
|---|---|
| `?time=13:00` | pretend it is a different time of day |
| `?date=2027-03-14` | pretend it is another date (day-of-the-day strip, weekday) |
| `?theme=light` | preview a theme (`dark`, `light`, `colorful`, `colorful2`) |
| `?allday=1` / `?allday=0` | show the whole day, or drop each class as it finishes — the `אופן הצגת שיעורים` setting, without editing the sheet |
| `?upd` | preview the "עודכן" badge on a changed class |
| `?err=sheets` | preview the fault indicator (`sheets`, `github`, `offline`) |

## Repository layout

| Path | What is in it |
|---|---|
| [`dashboard/`](dashboard/) | the board itself — this is what the TV shows |
| `dashboard/config.js` | display settings; contains **no** sheet URLs by design |
| `dashboard/logic.js` | pure functions (dates, gematria, parsing) — unit-tested |
| `dashboard/days.js` | the "day of the day" calendar (Israeli + international) |
| `dashboard/vacations.js` | **generated** — school-closure dates from the Ministry of Education |
| `dashboard/app.js` | everything touching the DOM, network, and clock |
| [`sheet-template/`](sheet-template/) | Apps Script that builds the Google Sheet, plus setup steps |
| [`pi/`](pi/) | Raspberry Pi provisioning scripts and walk-through |
| [`tools/`](tools/) | `fetch-vacations.js` — rebuilds `vacations.js` from the ministry feed |
| `.github/workflows/` | weekly job that re-runs that tool and commits any change |
| [`tests/`](tests/) | `node tests/run.js` — 188 tests, no dependencies |
| [`docs/`](docs/) | design spec, decisions, admin guide, TV settings, exercises |

## School holidays

The board goes quiet on days the school is shut: header, clock and one
line naming the vacation, nothing else. Those dates are **generated**
into `dashboard/vacations.js` from the Ministry of Education's published
feed, refreshed weekly by a GitHub Action:

```bash
node tools/fetch-vacations.js        # or let the Action do it
```

The board cannot read that feed directly — it sends no CORS headers — so
the dates ship as a plain script from the board's own origin.

Two traps the tool handles, both of which would put a wrong board on a
wall:

- the feed contains one malformed 369-day "summer" record, which taken
  literally blanks the board for a year. Ranges over 100 days are
  rejected and summer is rebuilt from the school year instead.
- vacations are **ranges**. An earlier version marked single Hebrew dates
  and so covered only the first day of each break — 37 days uncovered,
  and the whole Hanukkah break missed, because Kislev 25 falls the day
  before the ministry's break starts. A test now checks every day of
  every published range.

Closures the ministry cannot know about — a trip, a strike — go in the
sheet's `ימים ללא לימודים` tab instead, per grade or for everyone.

## Running the tests

```bash
node tests/run.js
```

No `npm install`, no framework, nothing to keep up to date. The tests
cover the logic that would be genuinely annoying to debug on a TV in a
corridor: Hebrew date conversion, date parsing from the sheet, and the
rules for which rows to show.

## Deploying it

1. **The sheet**: follow [`sheet-template/README.md`](sheet-template/README.md).
   You end with a document id (or publish token), five gids for the
   shared tabs and six more for the per-grade timetables — do **not**
   commit them.
2. **The page**: push this repo to GitHub, then **Settings → Pages →
   Deploy from a branch → `main` / root**. Your board lives at
   `https://<your-user>.github.io/<your-repo>/dashboard/`.
3. **The Pi**: follow [`pi/README.md`](pi/README.md), giving it
   `DASH_URL` = the Pages URL **plus** the `#d=…&g=…&s=…` fragment.
4. **The TV**: follow [`docs/tv-setup.md`](docs/tv-setup.md).

Do them in that order — each step wants the output of the one before it.

## Editing the sheet's script

The Apps Script that builds and maintains the spreadsheet lives in
[`sheet-template/setup.gs`](sheet-template/setup.gs) and is deployed with
`clasp push` rather than copy-paste — see
[`sheet-template/PUSHING.md`](sheet-template/PUSHING.md). Rule changes
apply themselves the next time the sheet is opened; only structural
changes need `setup` run by hand.

## Learning your way in

If you are new to this and want to change something, start with
[`docs/exercises.md`](docs/exercises.md). It has small, safe changes with
a clear "you did it" at the end of each, from changing a color to adding
a whole new panel.
