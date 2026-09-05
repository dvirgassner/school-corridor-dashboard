# Handoff — school corridor dashboard

State as of **2026-09-05**. Board `0.214`, Apps Script `0.203`, 311 tests
passing.

## What it is

A Raspberry Pi (`kit`) drives a Samsung 65" TV in a corridor at תיכון
השיטה. It shows a Hebrew/RTL dashboard served from GitHub Pages, fed by a
Google Sheet the principal edits. No server, no build step, no database.

Read next, in this order: `README.md` (how it fits together),
`docs/decisions.md` (why, including the traps), `pi/README.md` (the Pi),
`docs/admin-guide.md` (what the principal sees).

**Deployment specifics — addresses, keys, gids, ping URLs — are NOT in
this repository.** They are in `corridor-board-PRIVATE-notes.md`, kept
outside the repo. Without it you cannot reach the Pi.

On Dvir's PC that file is `C:/Users/DvirGassner/projects/corridor-board-PRIVATE-notes.md`.
Offline backups of the Pi's live scripts/configs, the relay VPS config and
the Google Sheet (xlsx + per-tab CSV) live beside it in
`C:/Users/DvirGassner/projects/corridor-board-backups/<component>-<date>/`,
each folder self-describing (see its README). Refresh them after any change
to the Pi, the relay, or the sheet's structure.

## Live right now

- Board deployed, showing real data.
- Sheet has the five shared tabs plus **six per-grade timetable tabs**
  (`מערכת ז` … `מערכת יב`); the principal is using it.
- **Timetables rewritten 2026-09-05 from the school's new PDFs** (one
  PDF per grade; kept out of this public repo, in the backups folder as
  `timetables-2026-09-05/` — private notes §8). 113 cell ranges across
  the six tabs, values only — the grid is a fixed 4-rows-per-period
  template (main row = sheet row 4P, plus 3 continuation rows; day columns
  D/E … N/O), so nothing was inserted or deleted. Before/after snapshots
  and the exact write plan are in the backups folder (private notes §8).
  Diff rules agreed with Dvir: teacher names are ignored except in a
  period split between several groups; same-subject groups sharing a room
  are one entry with both names; order inside a split is not a change.
  The PDFs store Hebrew character-mirrored — `pdfplumber` table extraction
  + reverse each cell, then un-reverse digit runs. `markitdown` alone loses
  the grid.
- **Video messages are switched off** (Apps Script `0.203`, 2026-09-05):
  the principal must not be able to put a clip on the corridor screen.
  One flag, `VIDEO_MESSAGES = false` in `setup.gs`, drops `וידאו` from
  the `סוג` dropdown and stops the script styling/validating columns C-D
  of `הודעות`; the columns themselves were deleted in the sheet by hand.
  Nothing that plays a video was removed — `app.js`/`logic.js` are
  untouched and the column names and rules stay in the script behind the
  flag. To bring it back: flip the flag, bump the version, `clasp push`,
  run `setup()` once (re-creates C-D), and restore the video section in
  `docs/admin-guide.md` (now a one-line "switched off" note).
- **The board reads the six per-grade tabs and renders concurrent
  classes with rooms** (`0.210`, the approved card redesign). **The Pi
  is repointed**: its kiosk URL carries `&s=<six gids>` and the board
  reads eleven tabs a cycle, all returning 200 — verified from inside
  the live page (408 responses observed, 407×200 and the one 400 below).
- **A grade with no lessons at all today says so** (`0.214`). כיתה יב on
  a Friday has nothing in the sheet; it used to share the "empty" state
  with a grade whose lessons had finished, so both read "יום הלימודים
  הסתיים". `tick()` in `app.js` now adds a `.noschool` class on the
  zero-slots branch (and clears it whenever a card does have slots, so it
  cannot survive stale across ticks); `style.css` gives that combination
  "אין לימודים היום". The "day over" wording is unchanged for a grade
  that actually had a day.
- **The legacy single-`מערכת` path is DEAD, not a fallback.** `g=`
  position 0 names the all-grades tab the six-tab migration replaced,
  and that gid now answers **HTTP 400**. Anything that falls back to it
  — a build without `s=` support, a rollback, a malformed `s=` — fails
  every cycle. This is exactly what put "מנותק מגוגל שיטס" over a
  correctly-rendered board during the repoint; see `0.213`. The gid
  stays in the URL because `g=` is positional and the four tabs after it
  are live, but treat position 0 as a tombstone.
- Remote access via a reverse-SSH relay on port 443 (Tailscale and
  Cloudflare are both blocked by the school's SNI filter — do not retry
  them without new evidence).
- Ministry vacation dates auto-refresh weekly via a GitHub Action.
- **The TV schedule works end to end.** This was an open question for
  weeks and the 2026-09-04 audit closed it: the healthchecks flip history
  for 30.08–04.09 shows every outage ending *exactly* at a CEC wake, so
  every `on 0` lands. What darkens the corridor is the set's own **Auto
  Power Off** (~4 h idle → standby), which no CEC command resets — hence
  the recurring drop around 11:00. Stopgaps live since 2026-09-04: wake
  every 30 minutes (`0,30 8-17 * * 0-4`, `0,30 8-13 * * 5`) and probe at
  `5,15,25,35,45,55` so a probe never shares a second with a wake. The
  real fix is to disable Auto Power Off at the set, in person; Dvir
  intends to within days.
- **TV identity.** The set is labelled **Samsung QE65S95B**, but over
  HDMI — EDID, `wlr-randr`, CEC — it reports as **`QBQ90S`**. Both are
  correct. Write it as "QE65S95B (reports as QBQ90S over HDMI)" and do
  not "correct" either name into the other.
- **Monitoring: three healthchecks.io checks.** The Pi heartbeat is solid
  and has been up continuously since 28.08; the TV state check is the one
  that flips; and a **"Relay" check exists but has never been pinged**
  (`n_pings` 0) — it is a placeholder, not coverage. A read-only API key
  is in the private notes: with it `/api/v3/checks/` and
  `/api/v3/checks/<unique_key>/flips/` work, `/pings/` does not (that
  needs a full-access key).
- **journald on the Pi is persistent** since 2026-08-31, three boots
  retained. That is the only reason the 03.09 reboot and the wake/probe
  history could be reconstructed at all — do not let it revert to
  volatile.

## The traps that cost the most time

1. **Forcing the HDMI mode disables CEC.** `video=…@60D` in `cmdline.txt`
   makes the Pi boot with a picture when the TV is asleep — and skips the
   driver `detect()` that hands CEC its address. Every CEC command then
   fails with `ENONET`, silently, because the cron jobs discard output.
   The TV schedule never ran for weeks. `pi/cec-fix.sh` un-forces after
   boot. **Do not remove one without the other.**

2. **`/sys` cannot tell you whether the TV is on.** A set in standby
   reports `connected` with a full 256-byte EDID. Only CEC knows. Do not
   build display monitoring on the connector state.

3. **Vacations are ranges, not dates.** Marking single Hebrew dates left
   37 vacation days uncovered and missed Hanukkah entirely, because
   Kislev 25 falls the day *before* the ministry's break starts. The
   ministry feed also ships one malformed 369-day record that would blank
   the board for a year if believed.

4. **Two tabs can spell the same grade differently and never match.**
   The per-grade timetable tabs title themselves `מערכת שעות לכיתה ז'`
   with an ASCII apostrophe; the events and closures tabs head their
   tick-box columns `ז׳` with a Hebrew geresh. Identical on screen, not
   equal in code — so every event chip and every per-grade closure would
   have silently stopped matching the moment the grade list started
   coming from the timetable tabs. `gradeCell()` in `logic.js` matches on
   the letters instead. Anything that compares a grade name across tabs
   must go through it.

5. **A second Chromium on the kiosk's shared profile crashes both.** Manual
   SSH launch for debugging competes with the autostarted instance for one
   profile directory, corrupting both. Exit of the manual one kills both
   instances together — live board down. The crash is often silent but may
   trigger a gnome-keyring modal on the TV (unanswerable without a
   keyboard) before watchdog recovery ~5 seconds later. Fix: `--user-data-dir=/tmp/check --headless`.

6. **Re-running `pi/setup.sh` would delete the live watchdog cron.** Its
   cleanup step filters the crontab with `grep -v "corridor-board"`, and
   the live watchdog line is tagged `# corridor-board-watchdog` — so the
   filter eats it, and setup.sh does not put it back: `board-watchdog.sh`
   is **not in this repository at all**. The `*/3 * * * *
   /home/dvir/board-watchdog.sh` job would simply vanish, leaving nothing
   to restart a dead kiosk. The live crontab has drifted from setup.sh in
   other ways too — the `-tv` / `-wake` / `-watchdog` tags, line order,
   missing comment blocks. **Do not run setup.sh on the wall Pi** until
   the two are reconciled and the watchdog script is in the repo.

7. **The probe and the wake must never share a minute.** The TV probe used
   to run at `*/10`, so the 07:00 probe fired in the same second as the
   07:00 CEC wake, read the set while `on 0` was still in flight, saw
   standby during school hours and paged — one false DOWN email every
   morning. The offset schedule `5,15,25,35,45,55` is deliberate, not
   untidy: leave it alone, because "simplifying" it back to `*/10`
   silently restores the daily false alarm.

8. **The dead position-0 gid serves a stale board from cache.** The hidden
   tab at `g=` position 0 answers HTTP 400 through the CSV export, so any
   old bookmark *without* `&s=` fails every fetch and falls back to the
   localStorage copy — which can be a full day old, and renders perfectly
   while doing it. That is how Dvir saw the stale word "חדר" on a laptop
   on 03.09 while the wall was showing the correct board. Always share
   the URL **with `&s=`**. Retiring or clearing that tab is still an open
   decision.

## Standing rules

- **Never risk the Pi's network connection.** Losing it costs the data
  *and* SSH, and recovery means driving to the school. Full rule in
  `CLAUDE.md`; it has been violated once already.
- `setup()` must never write to cells the principal typed. Enforced by
  `tests/setup-safety.js`, which pins the only permitted write.
- Test failure modes on a bench machine, never on the wall.

## Working on this project efficiently

- **One task per fresh Claude session**, started in the repo directory.
  Sessions here get long and Pi-heavy; a clean one is cheaper than a
  confused one.
- **Never `--resume` an old long session.** Re-read this file instead.
- **State lives in files, not in chat.** If a fact only exists in a
  transcript, it is lost — put it in `HANDOFF.md`, `docs/decisions.md`
  or the private notes.
- **Refresh this file at the end of every session**, while the reasons
  are still fresh. Update in place; this is not a changelog.
- **Sonnet for routine edits** (board code, docs, tests), **Opus for Pi
  debugging** — the Pi failures are the ones where a wrong guess costs a
  trip to the school.
- **Anything touching the Pi goes through a subagent** carrying the
  safety rules from `CLAUDE.md` verbatim, not from memory.
- **Verify on the wall, not in a browser tab.** Take a Pi screenshot
  (`pi/screenshot.sh`); a laptop tab can be serving a day-old cache
  (trap 8) and tells you nothing about what the corridor sees.

## Open items

| Item | State |
|---|---|
| **Under-voltage** | Downgraded. `get_throttled` now reads `0x80008` — thermal soft-limit at 60 °C on a Pi 3B+, no under-voltage bit set. Covers only since the 03.09 reboot. Watch the temperature; the UV problem is gone. |
| **TV's Auto Power Off** | The wake works (see *Live right now*); the idle timer is what darkens the corridor. Must be disabled at the set, in person — `docs/tv-setup.md`. The half-hourly wake only masks it. |
| **Theme re-pick in הגדרות** | `setup()` has run on `0.202` and rebuilt the grid, but the theme cell still holds a superseded name from before the dropdown was renamed. Re-pick it in the sheet. |
| **Repoint the Pi to the six tabs** | **Done.** The kiosk URL carries `&s=<six gids>`; all six grade tabs read 200 from the board itself. Not reversible after all: dropping `s=` now falls back to a tab that answers HTTP 400. |
| **Relay VPS has no monitoring of its own** | A healthchecks "Relay" check exists but **nothing has ever pinged it**. Needs its ping URL (Dvir to supply) and a cron on the VPS — ideally one that also asserts the reverse tunnel's port 2222 is listening, because the 2026-08 lockout was IPv4-only sockets on a perfectly healthy VPS, not a dead one. |
| **Unclean reboot, Thu 2026-09-03 ~09:19–09:20** | Mid school day, no shutdown sequence in the journal — a power interruption or the hardware watchdog. Persistent journald was enabled before it, and still shows nothing; the cause is unrecoverable after the fact. Open in case it repeats. |
| **Dead position-0 tab** | Retire it, clear it, or leave it as a tombstone — pending Dvir's decision. See trap 8. |
| **`setup.sh` ↔ live crontab** | They have drifted, and setup.sh would delete the watchdog job (trap 6). Reconcile them, and bring `board-watchdog.sh` into the repo — it currently exists only on the Pi. |
| **Service worker offline** | Never verified, and must not be tested on the wall Pi. |
| **`gviz` by name** | Would remove tab gids from the board URL entirely; verified it works and sends CORS. Trade-off: a gid survives a tab rename, a name does not. Argued in `docs/decisions.md`, not acted on. |

## Conventions worth keeping

- Comments explain **why**, especially where the obvious thing is wrong.
  Several here exist only because a plausible fix was tried and failed.
- Every bug fixed gets a test that fails without the fix — several were
  mutation-tested to prove they actually bite. One theme test was
  initially vacuous and passed against a deliberately broken value.
- Failure modes default to *showing* the board. An unreadable tab, a
  half-typed row, a transient fetch error — none of them blank a working
  screen, because from a corridor that is indistinguishable from a fault.
