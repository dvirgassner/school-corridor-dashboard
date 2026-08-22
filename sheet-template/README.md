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
6. When it finishes you get a confirmation dialog and four tabs:
   `מערכת`, `מבחנים`, `אירועים`, `הודעות` — with headers, sample rows,
   and validation already in place.

Re-running `setup` rebuilds the tabs from scratch — it **erases
existing content**, so only run it again on a fresh sheet.

## 2. Publish the four tabs as CSV

The board reads the sheet as four plain CSV feeds.

1. **File → Share → Publish to web**.
2. In the dialog, choose the **Entire document → no**: pick a single
   tab from the left dropdown, and **Comma-separated values (.csv)**
   from the right one.
3. Press **Publish** and copy the link.
4. Repeat for all four tabs. You end up with four URLs that look like
   `https://docs.google.com/spreadsheets/d/e/2PACX-…/pub?gid=0&single=true&output=csv`.

## 3. Point the board at the sheet

Edit [`../dashboard/config.js`](../dashboard/config.js) and replace
`sheets: null` with the four URLs:

```js
sheets: {
  schedule: "…gid=0…output=csv",   /* מערכת   */
  exams:    "…gid=1…output=csv",   /* מבחנים  */
  events:   "…gid=2…output=csv",   /* אירועים */
  messages: "…gid=3…output=csv"    /* הודעות  */
},
```

Commit and push; the board picks up the change on its next reload.
While `sheets` stays `null` the board runs in **demo mode** with the
bundled sample data, which is how you can develop with no sheet at all.

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

| Tab | Column | Meaning |
|---|---|---|
| מערכת | `Day` | א–ו (Sunday–Friday) |
| | `Period`, `Start`, `End` | period number and `HH:MM` times |
| | one column per grade | the subject; empty = no class |
| מבחנים | `Date`, `Grade`, `Subject`, `Start`, `End`, `Room` | one grade per exam; enter the subject only — the board displays "מבחן ב…" |
| אירועים | `Date`, `Grades`, `Title`, `Start`, `End`, `Location` | `Grades` is comma-separated; 4+ grades display as "כל השכבות" |
| הודעות | `Text`, `Type`, `VideoURL`, `From`, `Until`, `Active` | `Type`: רגילה / דחופה / וידאו · `Active`: כן / לא · empty dates = always |

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
