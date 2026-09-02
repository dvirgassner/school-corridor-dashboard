# The Google Sheet — one-time setup

The sheet **is** the admin app. There is no server, no login to
maintain, no password to reset: whoever can edit the sheet can change
the board, and Google handles the accounts.

## 1. Create the sheet

1. Go to <https://sheets.new> (signed in with the school's Google account).
2. Name it something like `לוח מסדרון — תיכון השיטה`.
3. **Extensions → Apps Script**.
4. Delete whatever is in the editor, paste the whole contents of
   [`setup.gs`](setup.gs), and press **Run**.
5. Google will ask for authorization the first time ("This app isn't
   verified" → Advanced → Go to project). That is expected: the script
   is yours and only touches this one spreadsheet.
6. When it finishes you get a confirmation dialog and five tabs:
   `מערכת`, `מבחנים`, `אירועים`, `הודעות`, `הגדרות` — with headers,
   sample rows, and validation already in place.

### Re-running `setup` is safe, at any point in the sheet's life

`setup` applies the current design, notes, protections and validation to
whatever is already there. It **never erases content**: the example rows
go only into a tab that is empty, so once the school's real timetable is
in, every later run restyles and re-validates and seeds nothing.

That is enforced rather than intended. Every content write goes through
one of four named helpers — `writeHeader_()`, `writeDayColumn_()`,
`rebuildScheduleGrid_()` and `seedIfEmpty_()` — and `node tests/run.js`
fails if a content-mutating call appears anywhere else, or if running
`setup()` against a mock sheet full of realistic data changes a single
cell outside those helpers' own columns. See
[`tests/setup-safety.js`](../tests/setup-safety.js).

The first three own *generated structure* — the header row, and the
`יום`, `שיעור`, `התחלה` and `סיום` columns in `מערכת`, which are locked
and cannot be typed into. Only `seedIfEmpty_()` ever writes where a
person could have, and it refuses any tab holding so much as one cell.

**The write-safety rule for `מערכת`, in full.** `setup()` writes the
tab's script-owned columns A-D only while the tab holds **no subject and
no room**. The moment one is present it writes **column A alone** — the
day letters, over the day blocks as they really stand — and it refuses
the tab outright if the geometry under those subjects is an older,
shorter one, saying so rather than moving anything.

The wide half of that rule is what repairs a tab left half-migrated. A
timetable built to the previous eleven-period grid, whose subject cells
were then cleared, kept its old period numbers and bell times in B-D:
only column A was ever rebuilt, so the new fourteen-row day letters ended
up sitting over an eleven-row grid — period 1 at 08:30, a second period 0
halfway down Sunday. On such a tab there is no lesson that could be moved
under the wrong day, so `setup()` now rebuilds the whole skeleton and
clears whatever an older shape left below it. Running `setup` again is
the entire repair.

Two consequences worth knowing, both verified by those tests:

- **A stricter rule never rejects data already in a cell.** Validation
  governs the next entry, not the current one — an exam dated outside the
  allowed window, or a subject name over the length limit, stays exactly
  as typed.
- **Checkbox ticks survive.** The script uses checkbox *validation*, not
  `Range.insertCheckboxes()`, which would set every box it touches to
  `false` and silently clear the grade ticks on every event.

`setup` is deliberately absent from the לוח מסדרון menu. It is run from
the Apps Script editor by whoever maintains the board.

## 2. Publish the five tabs as CSV

The board reads the sheet as five plain CSV feeds.

1. **File → Share → Publish to web**.
2. In the dialog, choose the **Entire document → no**: pick a single
   tab from the left dropdown, and **Comma-separated values (.csv)**
   from the right one.
3. Press **Publish** and copy the link.
4. Repeat for all five tabs. You end up with five URLs that look like
   `https://docs.google.com/spreadsheets/d/e/2PACX-…/pub?gid=0&single=true&output=csv`.

## 3. Point the board at the sheet — without putting the URL in the repo

The four published URLs all look like this:

```
https://docs.google.com/spreadsheets/d/e/<TOKEN>/pub?gid=<GID>&single=true&output=csv
                                          ^^^^^^^          ^^^^^
                                     same for all four   one per tab
```

So the sheet is identified by **one token plus four gids**. Rather than
committing those to this repository — which is public, and would let
anyone read the school's sheet — they are given to the board at runtime
in the **URL fragment**, which lives only on the Pi:

```
https://<you>.github.io/<repo>/dashboard/#t=<TOKEN>&g=<gid-מערכת>,<gid-מבחנים>,<gid-אירועים>,<gid-הודעות>,<gid-הגדרות>
```

**The gid order matters:** מערכת, מבחנים, אירועים, הודעות, הגדרות.
The fifth (הגדרות) is optional — leave it out and the board uses the
default dark theme.

Collect the token and the gids from the URLs you copied in step 2,
assemble that one line, and give it to the Pi as `DASH_URL`
(see [`../pi/README.md`](../pi/README.md)). `pi/setup.sh` stores it in
`~/.dashboard-env` with `chmod 600`, and nothing else on the Pi or in
this repo holds it.

### Why the fragment specifically

A URL fragment is **never transmitted to the web server**. The browser
strips it before making the request, so GitHub never receives — and
cannot log — the sheet token, even though GitHub is serving the page.
This was verified against a real server, not assumed: the page host's
request log shows only `/index.html`, `/app.js`, `/style.css` and
friends, with no token anywhere. A query string (`?t=…`) would **not**
be safe, because query strings are sent to the server.

A pleasant side effect: anyone opening the public GitHub Pages URL
without a fragment sees the **demo board with sample data**, never the
school's real content.

### Simpler alternative: link sharing instead of publishing

Publishing five tabs one by one is tedious. There is a second form the
board accepts, which needs **one** setting instead of five publishes:

1. In the sheet: **Share → General access → Anyone with the link →
   Viewer**. (Editing still requires the accounts you invited.)
2. Take the document id out of the sheet's normal address bar URL:
   `https://docs.google.com/spreadsheets/d/`**`<DOCUMENT-ID>`**`/edit`
3. Use `#d=` instead of `#t=`:

```
https://<you>.github.io/<repo>/dashboard/#d=<DOCUMENT-ID>&g=<gid>,<gid>,<gid>,<gid>,<gid>
```

The gids are the same numbers, visible in the address bar as `#gid=…`
when you click each tab.

Both forms are equally public-by-URL, and both were verified to allow
the cross-origin read the board needs. Pick whichever you find easier;
`#d=` is usually the answer.

### If you would rather keep the URLs in code

`config.js` still accepts a `sheets` object with the four full URLs.
Only do this if the repository is private or the files are served from
the Pi itself.

## What the script locks, and what it automates

`setup()` leaves two safeguards behind, both aimed at the same risk: the
board finds its data by **column header name**, so a renamed header
silently empties a panel with no error anywhere.

### What survives without the script, and what does not

This distinction matters, because the script can be deleted by accident.

**Stored in the spreadsheet itself — permanent, script or no script:**

- **Protected ranges.** Header rows in every tab, and the setting-name
  column in `הגדרות`, are editable only by the account that ran the
  script. Protection is a native Sheets feature written into the
  document; deleting the Apps Script project does not weaken it.
- **Data validation.** Dropdowns, checkboxes, date/time formats and the
  length limits are all native rules.
- **Conditional formatting.** A row where `כולם` *and* an individual
  grade are both ticked turns red, so the contradiction is visible even
  with no code running anywhere.

**Needs the script present:**

- **Automatic enforcement** of the `כולם` / per-grade exclusivity: tick a
  grade and `כולם` clears itself. Without the script the red highlight
  still appears, but nothing corrects it — and the board resolves the
  ambiguity deterministically anyway (`כולם` wins).
- **Repair after a paste** (below).

### Pasting

A paste in Google Sheets carries the *source* cell's formatting and
validation with it, which strips checkboxes and dropdowns from wherever
it lands. Sheets offers no way to forbid that. So instead of pretending
prohibition works, the script repairs it: any multi-cell edit in a known
tab triggers re-application of that tab's rules, and the `כולם`
exclusivity is re-enforced for the pasted rows.

Two further safeguards: a paste over a **protected** header row is
refused outright by Sheets, and the sheet gets a **לוח מסדרון** menu with
**תיקון חוקי הגיליון**, so anyone can restore every dropdown and checkbox
without waiting for help. Tell the office that menu item exists — it is
the answer to "the tick boxes disappeared".

For a clean bulk import, **Ctrl+Shift+V** (paste values only) leaves the
destination's validation intact.

## 4. Give the principal access

**Share** the spreadsheet with the principal's Google account as
**Editor**. That is the entire permission model.

## Privacy: never put personal data in this sheet

Publishing a tab to the web makes it readable by anyone who has the
link. That is fine for a corridor board — schedules, exam times and
announcements are already public inside the school — but it means:

> **Never** enter student names, ID numbers, grades/marks, phone
> numbers, or any other personal data in this sheet.

Editing stays restricted to the accounts you shared it with; only
*reading* is open.

## Field reference

Headers are in Hebrew, since the principal is the one editing. (The
dashboard also accepts the English equivalents, so an older
English-headed sheet keeps working.)

| Tab | Column | Meaning |
|---|---|---|
| מערכת | `יום` | א–ו (Sunday–Friday), one merged cell per day |
| | `שיעור`, `התחלה`, `סיום` | period 1–14 (1–6 on Friday; there is no period 0) and `HH:MM` times — all four leading columns are script-written and locked |
| | two columns per grade | the subject, then `<grade> חדר` for the room; empty = no class |
| | a row with the four leading columns BLANK | a concurrent class in the slot above: the principal inserts it to split one period into groups, and fills in only that group's subject and room |
| מבחנים | `תאריך`, `שכבה`, `מקצוע`, `התחלה`, `סיום`, `חדר` | one grade per exam; enter the subject only — the board displays "מבחן ב…" |
| אירועים | `תאריך`, `כותרת`, `התחלה`, `סיום`, `מקום`, then one **checkbox column per grade**, plus `כולם` | tick every grade the event applies to, or tick `כולם` for a whole-school activity; `כולם` or 4+ grades display as "כולם" |
| הודעות | `הודעה`, `סוג`, `קישור`, `מתאריך`, `עד תאריך`, `פעיל` | `סוג`: רגילה / דחופה / וידאו · `פעיל`: כן / לא · empty dates = always |
| הגדרות | `הגדרה`, `ערך` | presentation settings; currently `ערכת נושא` = כהה / בהירה / צבעונית |

### Special characters are safe

Type freely: commas, quotation marks, apostrophes, emoji, parentheses,
`&`, and mixed Hebrew/English/numbers all display correctly. Google
publishes such cells as properly quoted CSV, the board parses them with
PapaParse, and all text is HTML-escaped and bidi-isolated before it is
drawn — so no cell content can break the layout or the page. Line breaks
inside a cell (Alt+Enter) become single spaces, since every field on the
board is one line.

### Length limits (enforced by the sheet)

Derived from each element's width on the 1920×1080 board, so text can
never overflow its box:

| Field | Max characters |
|---|---|
| Schedule subject | 16 |
| Exam subject | 12 |
| Exam room | 12 |
| Event title | 22 |
| Event location | 12 |
| Normal message | 90 |
| Urgent message | 90 |
| Grade column header | 4 |

### Video clips

Only for rows with `Type = וידאו`: put a **direct link to an MP4 file**
(H.264, 1080p30 or smaller) in `VideoURL`. The clip plays full-screen at
most once every 10 minutes while the row is active, then the board
returns. Clips are **muted** unless the URL ends with `#sound`.

### Capacity

The agenda panel physically fits about **6 entries** (about 3 if a 7th
grade is added). Later entries that do not fit are not displayed, so keep
each day's list to what matters.
