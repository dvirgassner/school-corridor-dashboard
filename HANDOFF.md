# Handoff — school corridor dashboard

State as of **2026-08-28**. Board `0.200`, Apps Script `0.197`, 188 tests
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
- Sheet has six tabs; the principal is using it.
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
| **Run `setup()`** | Pending, for the renamed theme dropdown. Then re-pick the theme — the cell holds a superseded name, which still works but shows as off-list. |
| **Service worker offline** | Never verified, and must not be tested on the wall Pi. |
| **`gviz` by name** | Would remove tab gids from the board URL entirely; verified it works and sends CORS. Trade-off: a gid survives a tab rename, a name does not. Argued in `docs/decisions.md`, not acted on. |
| **Relay VPS has no monitoring of its own** | The 2026-08 IPv4 lockout (see `docs/decisions.md`) was found by a human, not an alert — the Pi/TV healthchecks both depend on the relay already working. No check currently watches the relay itself. |
| **TV's Auto Power Off still enabled** | Samsung's own idle timer drops the TV to standby a few hours after waking, even after a CEC power-on. Needs disabling in person (see `docs/tv-setup.md`); the hourly CEC wake now masks it. |

## Conventions worth keeping

- Comments explain **why**, especially where the obvious thing is wrong.
  Several here exist only because a plausible fix was tried and failed.
- Every bug fixed gets a test that fails without the fix — several were
  mutation-tested to prove they actually bite. One theme test was
  initially vacuous and passed against a deliberately broken value.
- Failure modes default to *showing* the board. An unreadable tab, a
  half-typed row, a transient fetch error — none of them blank a working
  screen, because from a corridor that is indistinguishable from a fault.
