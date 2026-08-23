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

Re-running `setup` rebuilds the tabs from scratch — it **erases
existing content**, so only run it again on a fresh sheet.

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
| מערכת | `יום` | א–ו (Sunday–Friday) |
| | `שיעור`, `התחלה`, `סיום` | period number and `HH:MM` times |
| | one column per grade | the subject; empty = no class |
| מבחנים | `תאריך`, `שכבה`, `מקצוע`, `התחלה`, `סיום`, `חדר` | one grade per exam; enter the subject only — the board displays "מבחן ב…" |
| אירועים | `תאריך`, `שכבות`, `כותרת`, `התחלה`, `סיום`, `מקום` | `שכבות` is comma-separated; 4+ grades display as "כל השכבות" |
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
| Urgent message | 75 |
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
