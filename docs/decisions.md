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

## Why a nightly reboot?

Not because anything is known to leak. It is a cheap insurance policy
against the class of slow failures that are hard to reproduce and easy
to prevent: a browser that has been rendering the same page for three
months is not a well-tested configuration.
