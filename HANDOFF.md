# Handoff — school corridor dashboard

State as of **2026-09-02**. Board `0.210`, Apps Script `0.201`, 285 tests
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

## Live right now

- Board deployed, showing real data.
- Sheet has the five shared tabs plus **six per-grade timetable tabs**
  (`מערכת ז` … `מערכת יב`); the principal is using it.
- **The board now reads the six per-grade tabs and renders concurrent
  classes with rooms** (`0.210`, the approved card redesign). **The Pi
  is repointed**: its kiosk URL carries `&s=<six gids>` and the board
  reads eleven tabs a cycle, all returning 200 — verified from inside
  the live page (408 responses observed, 407×200 and the one 400 below).
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
- TV state monitored every 10 minutes over CEC to its own healthchecks
  check, separate from the Pi's heartbeat.

## The three traps that cost the most time

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

## Standing rules

- **Never risk the Pi's network connection.** Losing it costs the data
  *and* SSH, and recovery means driving to the school. Full rule in
  `CLAUDE.md`; it has been violated once already.
- `setup()` must never write to cells the principal typed. Enforced by
  `tests/setup-safety.js`, which pins the only permitted write.
- Test failure modes on a bench machine, never on the wall.

## Open items

| Item | State |
|---|---|
| **Under-voltage** | Unresolved. `0x50005` — throttled *now*, not historically. Needs a 5.1 V / 2.5 A supply with a captive cable. Can masquerade as a TV fault. |
| **CEC end-to-end** | Untested. First real trial is the 07:00 wake on Sunday 30 Aug; it has never once worked. |
| **Run `setup()`** | Pending, on `0.201`. It must rebuild the `מערכת` grid to periods 1-14 — the tab is still half-migrated, column A on the new geometry and B-D on the old. Confirm the toast says `מערכת: הלוח נבנה מחדש ואומת ✓`; anything else means it did not take. Also for the renamed theme dropdown — then re-pick the theme, the cell holds a superseded name. |
| **Repoint the Pi to the six tabs** | **Done.** The kiosk URL carries `&s=<six gids>`; all six grade tabs read 200 from the board itself. Not reversible after all: dropping `s=` now falls back to a tab that answers HTTP 400. |
| **Service worker offline** | Never verified, and must not be tested on the wall Pi. |
| **`gviz` by name** | Would remove tab gids from the board URL entirely; verified it works and sends CORS. Trade-off: a gid survives a tab rename, a name does not. Argued in `docs/decisions.md`, not acted on. |
| **Relay VPS has no monitoring of its own** | The 2026-08 IPv4 lockout (see `docs/decisions.md`) was found by a human, not an alert — the Pi/TV healthchecks both depend on the relay already working. No check currently watches the relay itself. |
| **TV's Auto Power Off still enabled** | Samsung's own idle timer drops the TV to standby a few hours after waking, even after a CEC power-on. Needs disabling in person (see `docs/tv-setup.md`); the half-hourly CEC wake now masks it. |

## Conventions worth keeping

- Comments explain **why**, especially where the obvious thing is wrong.
  Several here exist only because a plausible fix was tried and failed.
- Every bug fixed gets a test that fails without the fix — several were
  mutation-tested to prove they actually bite. One theme test was
  initially vacuous and passed against a deliberately broken value.
- Failure modes default to *showing* the board. An unreadable tab, a
  half-typed row, a transient fetch error — none of them blank a working
  screen, because from a corridor that is indistinguishable from a fault.
