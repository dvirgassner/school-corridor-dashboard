# Decisions — why this is built the way it is

Every choice here had at least one plausible alternative that we
rejected for a specific reason. Those reasons are worth more than the
code, because the code is easy to change and these are not.

## Why not run it on the TV itself?

The Samsung 65S95B is a smart TV running Tizen. Writing an app for it is
genuinely easy — a Tizen app is essentially this same HTML page in a
wrapper. We still rejected it, because of one fact:

> Consumer Samsung TVs cannot auto-start an app after a power cut.

Auto-start exists only on Samsung's *commercial signage* models. On a
home TV, the "Autorun Last App" setting relaunches the last app when the
TV wakes from standby, but it forgets after the TV loses mains power —
and then the screen shows the Samsung home screen until a human walks up
with a remote. In a school corridor, that human is not coming.

Three more problems compound it:

1. Sideloaded apps need the TV in developer mode, tied to a specific PC
   on the same network — so **fixing anything requires being physically
   at the school**, which defeats the main requirement.
2. Firmware and Smart Hub updates break sideloaded apps regularly (the
   Jellyfin community re-installs after updates as a matter of routine).
3. There is no remote path into a consumer TV. No SSH, no logs, nothing.

A $40 Raspberry Pi removes all four problems at once. The TV becomes a
monitor, which is the one job it does reliably forever.

## Why not an ESP32 or similar microcontroller?

It cannot work, for two independent reasons: no HDMI output, and a few
hundred kilobytes of RAM against the ~200 MB a browser needs to render
this page. ESP32s drive small SPI displays directly; they cannot put a
rendered web page on a 65" screen. (A per-classroom e-paper door sign
would be a lovely ESP32 project — just not this one.)

## Why not a digital-signage service (Yodeck, OptiSigns, …)?

These are good products and would have worked. We chose not to because:

- The board is **data-driven** — six grade columns, exam and event rows
  merged and sorted by time, adaptive layout for a 7th grade. Expressing
  that in a signage tool's slide editor is clumsy; in HTML it is natural.
- It adds a **vendor and a subscription** to a system that otherwise has
  neither, plus a second UI for the principal to learn.
- The signage player would still be a Raspberry Pi. Same hardware, less
  control.

## Why a Google Sheet instead of a real admin web app?

A custom admin app means authentication, user management, a server, a
database, hosting, backups, and password resets — all of it code we
would own and have to maintain for years, for a system whose entire job
is displaying about thirty rows of text.

The sheet gives us all of that for free, and the office staff already
know how to use it. Data validation in the sheet enforces the field
length limits, so bad input is caught at entry rather than at display.

The cost is real and accepted: a published CSV is readable by anyone with
the link. Hence the hard rule, stated in the admin guide and in the
sheet's own notes: **no student names, marks, or personal data, ever.**
Corridor content is public by definition.

## Why the sheet's address lives only on the Pi

The repository is public (free GitHub Pages requires it), so committing
the published-CSV URLs would hand the school's sheet to anyone who found
the repo. Instead the Pi's kiosk URL carries the sheet token in the
**fragment** (`#t=…&g=…`), and `~/.dashboard-env` on the Pi is the only
place it exists.

This works because browsers never transmit the fragment to the server:
the page can read it, but GitHub cannot see or log it. That claim was
tested rather than assumed — a local server logging every request
received only `/index.html`, `/app.js`, `/style.css` and friends, with no
token in any of them. A query string would have been sent to the server,
so `?t=…` would not do.

Consequences worth knowing:

- Code updates still flow by `git push`. Only a change of token needs
  SSH to the Pi, which is rare.
- Visiting the public URL shows the **demo** board, not school data.
- It is obscurity, not authentication: whoever holds the token can read
  the sheet, and revoking means re-publishing (which changes the token).
  So the no-personal-data rule stays in force regardless.

## Why cross-origin fetching dictated the endpoint

Google serves published sheets from several URL shapes, and they do not
behave alike. Measured against a live sheet:

| Endpoint | CORS header | Usable from a browser |
|---|---|---|
| `/d/e/<token>/pub?output=csv` | yes | **yes — what we use** |
| `/export?format=csv` | yes | yes |
| `/gviz/tq?tqx=out:csv` | **no** | no |

The `gviz/tq` form is widely recommended online and returns 200 to
`curl`, so it looks fine in a terminal and then fails silently in the
browser. If someone "simplifies" the fetch later, this is the trap.

## Why GitHub Pages?

Free, effectively never down, versioned, and it makes the repository the
deployment. There is no build step to break: the files you read are the
files that ship.

## Why is the design so dark, and why does the layout drift?

The S95B is a **QD-OLED** panel, and a static dashboard displayed ten
hours a day is the textbook way to burn an image into one. So:

- dark surfaces and softened off-white text (no pure-white fields)
- the whole canvas shifts a few pixels on a slow cycle — invisible to a
  passer-by, meaningful to the panel
- the screen is off outside school hours, which also lets the TV run its
  own nightly panel-care cycle
- video clips are, ironically, good for the panel: moving pixels

## Why is passed-class hiding and paging done this way?

Two mechanisms, in this order: classes that are over disappear (that is
the primary way space is recovered), and only whatever still does not fit
pages through with a slow slide. The result is that the board is mostly
motionless — busiest in the morning, calm by afternoon — instead of
animating for its own sake.

The paging slides the *minimum* distance needed to reveal the last class,
so a pane is never half-empty mid-cycle.

## Why is the clock the Pi's clock?

The board's notion of "today" and "now" drives which day's timetable is
shown and which classes are highlighted. Tying that to the Pi's
NTP-synced system clock (timezone `Asia/Jerusalem`) keeps it correct
without any code, and it keeps working when the network is down —
which is exactly when you do not want the board to get confused.

## Why is there no nightly reboot?

There was one, at 03:00, as insurance against the class of slow failures
that are hard to reproduce and easy to prevent — a browser rendering the
same page for three months is not a well-tested configuration.

It was removed once the cost became clear. A wlroots compositor builds
its output list from the HDMI connectors the kernel reports as
*connected*, and a TV in standby can drop that line. Boot the Pi with no
connected output and it invents a headless one, after which Chromium
renders the board into nothing: blank screen, healthy Pi, nothing in any
log. 03:00 is precisely when the TV is in standby, so the insurance
policy was itself a way to lose a whole school day.

The board is rebooted deliberately now, over SSH, when it needs it —
which is also why `video=HDMI-A-1:1920x1080@60D` is pinned in
cmdline.txt. That parameter is what makes a remote reboot dependable at
the hour you would actually issue one: in the evening, with the TV off.

## Why can't `setup` erase the sheet?

Because the sheet holds the school's timetable, and the script that
styles it is the same script that once built it. The original `setup`
called `sh.clear()` on every tab and wrote sample rows over the top —
fine for a template, catastrophic the first time a design change is
applied to a live sheet mid-term.

The fix was to split each tab builder in two. `styleX_()` applies
headers, widths, grade tints, day borders, notes, protections and
validation; it reaches every data row on purpose, because that is where
the colours and rules belong, but it never reads or replaces a value —
in Sheets a background or a dropdown is stored beside a cell's content,
not in place of it. `seedX_()` holds the example rows and runs only
against a tab that is empty.

The part that matters is that this is checked rather than trusted. Two
independent guards run on every `node tests/run.js`:

- **Behavioural.** A mock of the `SpreadsheetApp` API
  (`tests/sheets-mock.js`) lets the real `setup.gs` execute against a
  spreadsheet loaded with a full timetable, dated exams, ticked events,
  messages with quotes and emoji, and a chosen theme. Every cell is
  compared before and after; any difference fails the build.
- **Structural.** The source is scanned for content-mutating calls, which
  are legal only inside the four functions allowed to make one:
  `writeHeader_`, `seedIfEmpty_`, and the two that answer a checkbox
  click. This catches a destructive call added on a path the behavioural
  test happens not to reach.

Both were mutation-tested — `sh.clear()` reintroduced, each of
`seedIfEmpty_`'s two guards removed, a stray `setValues()` planted in a
style function, `insertCheckboxes()` swapped back in — and every mutation
was caught, most by several tests at once.

No destructive rebuild was kept, not even a hidden one. Starting a tab
over means deleting it by hand and re-running `setup`, which cannot
happen by accident.
