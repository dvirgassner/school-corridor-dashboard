# לוח מסדרון — School Corridor Dashboard

An information board for a school corridor: today's timetable for every
grade, today's exams and events, and messages from the principal. It runs
on a 65" TV in the hallway, updates itself from a Google Sheet, and needs
nobody standing next to it.

```
Principal (phone)                          You (anywhere)
     │ edits                                    │ Tailscale SSH
     ▼                                          ▼
Google Sheet ──published CSV──►  Raspberry Pi ──HDMI──►  Samsung TV
(4 tabs)                         Chromium kiosk           (dumb screen)
                                 showing this page
                                 hosted on GitHub Pages
```

## How it actually works

There is no server and no database anywhere in this project. That is the
whole design idea:

- **The Google Sheet is the admin app.** The principal edits four tabs
  from a phone. Google handles the accounts and the permissions.
- **The dashboard is one static web page.** It reads the sheet as four
  CSV feeds every 60 seconds and redraws itself. GitHub Pages hosts it
  for free and never goes down.
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
| `?demo7` | preview the layout with a 7th grade added |

## Repository layout

| Path | What is in it |
|---|---|
| [`dashboard/`](dashboard/) | the board itself — this is what the TV shows |
| `dashboard/config.js` | **the only file you edit** to connect a sheet |
| `dashboard/logic.js` | pure functions (dates, gematria, parsing) — unit-tested |
| `dashboard/app.js` | everything touching the DOM, network, and clock |
| [`sheet-template/`](sheet-template/) | Apps Script that builds the Google Sheet, plus setup steps |
| [`pi/`](pi/) | Raspberry Pi provisioning scripts and walk-through |
| [`tests/`](tests/) | `node tests/run.js` — 39 tests, no dependencies |
| [`docs/`](docs/) | design spec, decisions, admin guide, TV settings, exercises |

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
2. **The page**: push this repo to GitHub, then **Settings → Pages →
   Deploy from a branch → `main` / root**. Your board lives at
   `https://<your-user>.github.io/<your-repo>/dashboard/`.
3. **The Pi**: follow [`pi/README.md`](pi/README.md).
4. **The TV**: follow [`docs/tv-setup.md`](docs/tv-setup.md).

Do them in that order — each step wants the URL from the one before it.

## Learning your way in

If you are new to this and want to change something, start with
[`docs/exercises.md`](docs/exercises.md). It has small, safe changes with
a clear "you did it" at the end of each, from changing a color to adding
a whole new panel.
