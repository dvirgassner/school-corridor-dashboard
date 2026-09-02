/* ==================================================================
   setup-safety.js — does running setup.gs on a live sheet destroy
   anything?

   The sheet this script runs against holds the school's timetable, the
   term's exams and whatever the principal typed this morning. Reviewing
   the code is not enough; these tests execute the real setup.gs against
   a mock spreadsheet loaded with realistic content and compare every
   single cell before and after.

   Two independent guards, because they fail in different ways:

     1. BEHAVIOURAL — run it and diff the cells. Catches a destructive
        call that actually fires.
     2. STRUCTURAL — scan the source for content-mutating calls outside
        the four functions allowed to make one. Catches a destructive
        call added on a path the tests happen not to cover.

   Exported as a function so tests/run.js can fold the results into its
   own count.
   ================================================================== */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Spreadsheet, makeEnvironment } = require('./sheets-mock.js');

const SETUP_PATH = path.join(__dirname, '..', 'sheet-template', 'setup.gs');
const SOURCE = fs.readFileSync(SETUP_PATH, 'utf8');

/* Load setup.gs into a fresh sandbox with the mock globals in place, and
   hand back its functions. A new context per test means no state leaks
   between them. */
function loadScript(ss, opts) {
  const env = makeEnvironment(ss, opts);
  const ctx = vm.createContext(env.globals);
  vm.runInContext(SOURCE, ctx, { filename: 'setup.gs' });
  return { ctx, env };
}

/* ---------- a sheet that looks like the school's ---------- */

const DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];
const GRADES = ['ז׳', 'ח׳', 'ט׳', 'י׳', 'י"א', 'י"ב'];
/* A time-of-day as Sheets stores it: a fraction of a day. The fixture
   uses these rather than "08:00" strings because that is the steady
   state — setup converts text times once and then leaves them alone. */
const t = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h * 60 + m) / 1440;
};
/* the inverse of t(): a day fraction back to "HH:MM", for comparing a
   whole grid in one deepEqual and reading the failure when it differs */
const hhmm = (v) => {
  if (typeof v !== 'number') return String(v);
  const mins = Math.round(v * 1440);
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' +
         String(mins % 60).padStart(2, '0');
};
const PERIOD_TIMES = [
  ['08:15', '09:00'], ['09:00', '09:45'], ['10:10', '10:55'],
  ['10:55', '11:40'], ['12:00', '12:45'], ['12:45', '13:30'],
  ['14:00', '14:45'], ['14:45', '15:30'], ['15:30', '16:15'],
  ['16:15', '17:00'], ['17:00', '17:45'], ['17:45', '18:30'],
  ['18:30', '19:15'], ['19:15', '20:00']
].map((pair) => pair.map(t));

/* Friday (ו) ends after period 6 (13:30); every other day runs the full
   fourteen, numbered 1 to 14 — there is no period 0. Mirrors setup.gs's
   own SHORT_DAYS, kept as a separate literal here on purpose: the
   fixture must independently model the geometry setup.gs is supposed to
   produce, not borrow its logic and risk both sides being wrong
   together. */
const SHORT_DAYS = { 'ו': 6 };
const periodCount = (day) => SHORT_DAYS[day] || PERIOD_TIMES.length;

/* Row layout implied by periodCount: offsets are 0-based, relative to
   row 2 (the first data row). Shared by every test below that needs to
   know where a day's block starts or ends. */
function scheduleLayout() {
  const counts = DAYS.map(periodCount);
  const offsets = [];
  let total = 0;
  counts.forEach((c) => { offsets.push(total); total += c; });
  return { counts, offsets, total };
}

/* 5 x 14 + 6 = 76 data rows, so the tab ends at row 77. */
const TOTAL_ROWS = scheduleLayout().total;

/* Each grade owns two columns: the subject, then the room. Sixteen in
   all, and the room header is the grade's own label plus " חדר". */
const ROOM_SUFFIX = ' חדר';
const SCHED_HEADERS = ['יום', 'שיעור', 'התחלה', 'סיום'];
GRADES.forEach((g) => SCHED_HEADERS.push(g, g + ROOM_SUFFIX));
const SCHED_COLS = SCHED_HEADERS.length;

/* The mock only appends rows, so model "insert row below" here: splice a
   blank row into the values and grow whichever merged day block contains
   it — which is what Sheets itself does, and the reason an inserted
   split row keeps the day letter above it. */
function insertRowAt(sh, row) {
  sh.values.splice(row - 1, 0, Array(sh.maxCols).fill(''));
  sh.values.pop();
  sh.merges = sh.merges.map((m) => {
    const p = /^A(\d+):A(\d+)$/.exec(m);
    if (!p) return m;
    let top = Number(p[1]), bottom = Number(p[2]);
    if (row <= top) { top += 1; bottom += 1; }
    else if (row <= bottom) bottom += 1;
    return `A${top}:A${bottom}`;
  });
}

/* Deliberately awkward content: quotes, an emoji, an em dash, a comma,
   a subject over the length limit, and a בס"ד-style abbreviation with a
   double quote in the middle. If styling mangles any of it, the diff
   says exactly which cell. */
const REAL_SUBJECTS = [
  'מתמטיקה', 'תנ"ך', 'של"ח', 'אנגלית 🎉', 'ספרות — מגמה',
  'היסטוריה, מגמה מורחבת', 'שם מקצוע ארוך מאוד שחורג מהמגבלה'
];
const REAL_ROOMS = [
  'חדר 12', 'מעבדה', 'חדר 3', 'אולם', 'חדר 214', 'ספרייה',
  'שם חדר ארוך מאוד שחורג מהמגבלה'
];

function populatedSheet() {
  const ss = new Spreadsheet();

  const sched = ss.addSheet('מערכת');
  sched.getRange(1, 1, 1, SCHED_COLS).setValues([SCHED_HEADERS]);
  const layout = scheduleLayout();
  const rows = [];
  DAYS.forEach((day, di) => {
    const count = layout.counts[di];
    for (let pi = 0; pi < count; pi++) {
      const times = PERIOD_TIMES[pi];
      /* the day letter only on the first row of each block — the shape a
         merged יום column exports, and the shape setup() maintains */
      const row = [pi === 0 ? day : '', pi + 1, times[0], times[1]];
      GRADES.forEach((g, gi) => {
        const filled = pi < 8;
        row.push(filled ? REAL_SUBJECTS[(di + pi + gi) % REAL_SUBJECTS.length] : '',
                 filled ? REAL_ROOMS[(di + pi + gi) % REAL_ROOMS.length] : '');
      });
      rows.push(row);
    }
  });
  sched.getRange(2, 1, rows.length, SCHED_COLS).setValues(rows);
  DAYS.forEach((d, di) => {
    sched.getRange(2 + layout.offsets[di], 1, layout.counts[di], 1).merge();
  });

  const exams = ss.addSheet('מבחנים');
  exams.getRange(1, 1, 1, 6).setValues([
    ['תאריך', 'שכבה', 'מקצוע', 'התחלה', 'סיום', 'חדר']
  ]);
  exams.getRange(2, 1, 3, 6).setValues([
    [new Date(2026, 8, 3), 'ט׳', 'תנ"ך', t('09:00'), t('10:30'), 'חדר 12'],
    [new Date(2025, 4, 1), 'י"ב', 'אנגלית', t('11:45'), t('12:30'), 'ספרייה'],
    ['', 'ח׳', 'ביולוגיה', t('12:35'), t('13:20'), 'מעבדה']   /* no date on purpose */
  ]);

  const events = ss.addSheet('אירועים');
  events.getRange(1, 1, 1, 12).setValues([
    ['תאריך', 'כותרת', 'התחלה', 'סיום', 'מקום'].concat(GRADES).concat(['כולם'])
  ]);
  /* ticks in three different shapes: two grades, all-school, and none */
  events.getRange(2, 1, 3, 12).setValues([
    [new Date(2026, 8, 1), 'חזרה כללית לטקס', t('10:40'), t('11:25'), 'אולם',
     true, true, '', '', '', '', ''],
    [new Date(2026, 8, 2), 'טיול שנתי — הגליל', t('08:00'), t('15:00'), 'הסעות',
     '', '', '', '', '', '', true],
    [new Date(2026, 8, 4), 'אסיפת הורים', t('19:00'), t('20:30'), 'אודיטוריום',
     '', '', true, '', '', true, '']
  ]);

  const msgs = ss.addSheet('הודעות');
  msgs.getRange(1, 1, 1, 4).setValues([
    ['הודעה', 'סוג', 'קישור לוידאו (Google Drive או YouTube)', 'סאונד']
  ]);
  msgs.getRange(2, 1, 3, 4).setValues([
    ['אסיפת הורים ביום שלישי, 19:00, ב"אולם הגדול" 🎉', 'רגילה', '', ''],
    ['סרטון פתיחת שנה', 'וידאו', 'https://youtu.be/abc123XYZ', 'כן'],
    ['ההסעה יוצאת ב-14:00', 'דחופה', '', '']
  ]);

  /* Closures the ministry calendar cannot know about. Present here as a
     POPULATED tab, because the pinned-write test only proves setup() does
     not touch real content if the fixture actually holds some — a tab
     missing from the fixture gets created and seeded, which is a
     different code path and a much weaker check. */
  const closures = ss.addSheet('ימים ללא לימודים');
  closures.getRange(1, 1, 1, 10).setValues([
    ['מתאריך', 'עד תאריך', 'סיבה'].concat(GRADES).concat(['כולם'])
  ]);
  closures.getRange(2, 1, 3, 10).setValues([
    /* a multi-day closure for one grade */
    [new Date(2026, 8, 8), new Date(2026, 8, 10), 'טיול שנתי',
     '', '', true, '', '', '', ''],
    /* a single-day, whole-school closure: no "to" date at all */
    [new Date(2026, 9, 15), '', 'שביתה',
     '', '', '', '', '', '', true],
    /* a reason with no date — the shape dateFlags_ exists to catch */
    ['', '', 'פעילות מחוץ לבית הספר', '', '', '', '', '', '', '']
  ]);

  const settings = ss.addSheet('הגדרות');
  settings.getRange(1, 1, 1, 2).setValues([['הגדרה', 'ערך']]);
  settings.getRange(2, 1, 2, 2).setValues([
    ['ערכת נושא', 'בהירה'],
    ['אופן הצגת שיעורים', 'הצג רק משיעור נוכחי ואילך']
  ]);

  return ss;
}

/* The מערכת tab as commit c6684a6 built it: eleven periods numbered 0-10,
   five on Friday, and ONE column per grade with no room beside it. Used
   to prove that setup() refuses such a tab rather than restating a
   76-row skeleton over 60 rows of somebody's timetable. */
function oldShapeSheet() {
  const ss = populatedSheet();
  const sched = ss.getSheetByName('מערכת');
  sched.values = Array.from({ length: sched.maxRows },
                            () => Array(sched.maxCols).fill(''));
  sched.merges.length = 0;
  sched.getRange(1, 1, 1, 10).setValues([
    ['יום', 'שיעור', 'התחלה', 'סיום'].concat(GRADES)
  ]);
  const counts = [11, 11, 11, 11, 11, 5];
  const rows = [];
  DAYS.forEach((day, di) => {
    for (let pi = 0; pi < counts[di]; pi++) {
      rows.push([pi === 0 ? day : '', pi, t('08:15'), t('08:30')].concat(
        GRADES.map((g, gi) => REAL_SUBJECTS[(di + pi + gi) % REAL_SUBJECTS.length])));
    }
  });
  sched.getRange(2, 1, rows.length, 10).setValues(rows);
  let off = 0;
  counts.forEach((c) => { sched.getRange(2 + off, 1, c, 1).merge(); off += c; });
  return ss;
}

/* The OLD period table, exactly as commit c6684a6 shipped it: eleven
   periods numbered 0-10, opening with a fifteen-minute "period 0" before
   the day proper, and only five of them on Friday. Written out in full
   rather than approximated, because the regression tests below assert
   these SPECIFIC times are gone afterwards — a fixture that merely said
   "some old time" could not tell a rebuilt grid from an untouched one. */
const OLD_PERIODS = [
  [0, '08:15', '08:30'], [1, '08:30', '09:00'], [2, '09:00', '09:45'],
  [3, '10:10', '10:55'], [4, '10:55', '11:40'], [5, '12:00', '12:45'],
  [6, '12:45', '13:30'], [7, '14:00', '14:45'], [8, '14:45', '15:30'],
  [9, '15:30', '16:15'], [10, '16:15', '17:00']
];
const OLD_COUNTS = [11, 11, 11, 11, 11, 5];      /* 60 data rows, to row 61 */

/* Lay the old eleven-period grid into the מערכת tab with the SUBJECT
   cells empty — what is left after somebody selects the coloured columns
   and presses Delete. The period numbers and bell times in B-D are
   script-written, were never selected, and survive; so do the old merged
   day blocks in column A. This is the state the live sheet was in on the
   morning the bug was reported, BEFORE the new setup() was run on it. */
function clearedOldGridSheet() {
  const ss = populatedSheet();
  const sched = ss.getSheetByName('מערכת');
  sched.values = Array.from({ length: sched.maxRows },
                            () => Array(sched.maxCols).fill(''));
  sched.merges.length = 0;
  sched.getRange(1, 1, 1, 10).setValues([
    ['יום', 'שיעור', 'התחלה', 'סיום'].concat(GRADES)
  ]);
  const rows = [];
  DAYS.forEach((day, di) => {
    for (let p = 0; p < OLD_COUNTS[di]; p++) {
      const row = [p === 0 ? day : '', OLD_PERIODS[p][0],
                   t(OLD_PERIODS[p][1]), t(OLD_PERIODS[p][2])];
      GRADES.forEach(() => row.push(''));        /* subjects: cleared */
      rows.push(row);
    }
  });
  sched.getRange(2, 1, rows.length, 10).setValues(rows);
  let off = 0;
  OLD_COUNTS.forEach((c) => { sched.getRange(2 + off, 1, c, 1).merge(); off += c; });
  sched.writes.length = 0;
  return ss;
}

/* THE STATE THE LIVE SHEET IS IN RIGHT NOW — clearedOldGridSheet() after
   version 0.199's setup() has already run over it once:

     • column A rebuilt to the NEW geometry, one merged block per day,
       fourteen rows for א-ה and six for ו, letters at rows 2, 16, 30,
       44, 58 and 72;
     • columns B-D still the OLD eleven-row-per-day grid, so row 2 is
       period 0 at 08:15-08:30, row 3 period 1 at 08:30-09:00, row 12
       period 10, and row 13 a SECOND period 0 sitting in the middle of
       the א block — day letters and bell times completely out of step;
     • rows 62-77 empty in B-D, the old grid being sixty rows where the
       new one is seventy-six;
     • the header already widened to all sixteen columns.

   The fix has to repair THIS, not merely the state before it: the tab it
   has to put right is the one the principal is looking at. */
function messedUpSheet() {
  const ss = clearedOldGridSheet();
  const sched = ss.getSheetByName('מערכת');
  sched.getRange(1, 1, 1, SCHED_COLS).setValues([SCHED_HEADERS]);
  sched.merges.length = 0;
  const layout = scheduleLayout();
  const colA = [];
  DAYS.forEach((d, di) => {
    for (let i = 0; i < layout.counts[di]; i++) colA.push([i === 0 ? d : '']);
  });
  sched.getRange(2, 1, layout.total, 1).setValues(colA);
  DAYS.forEach((d, di) => {
    sched.getRange(2 + layout.offsets[di], 1, layout.counts[di], 1).merge();
  });
  sched.writes.length = 0;
  return ss;
}

/* Every value in every sheet, as a comparable string. Dates are stamped
   by time so a silently rewritten date is caught too. */
function snapshot(ss) {
  const out = {};
  ss.getSheets().forEach((sh) => {
    const cells = [];
    for (let r = 1; r <= sh.getMaxRows(); r++) {
      for (let c = 1; c <= sh.getMaxColumns(); c++) {
        const v = sh.values[r - 1][c - 1];
        if (v === '' || v === null || v === undefined) continue;
        cells.push(r + ',' + c + '=' +
          (v instanceof Date ? 'D' + v.getTime() : typeof v + ':' + String(v)));
      }
    }
    out[sh.getName()] = cells;
  });
  return out;
}

function diff(before, after) {
  const changes = [];
  const names = new Set(Object.keys(before).concat(Object.keys(after)));
  names.forEach((name) => {
    const b = new Set(before[name] || []);
    const a = new Set(after[name] || []);
    (before[name] || []).forEach((cell) => {
      if (!a.has(cell)) changes.push(`${name}: LOST ${cell}`);
    });
    (after[name] || []).forEach((cell) => {
      if (!b.has(cell)) changes.push(`${name}: ADDED ${cell}`);
    });
  });
  return changes;
}

/* ---------- the structural guard ---------- */

/* Calls that change what is IN a cell. Formatting, validation, notes and
   protection are all absent from this list on purpose — they are the
   whole point of the style pass. */
const MUTATORS = [
  '.setValue(', '.setValues(', '.clear(', '.clearContent(', '.clearContents(',
  '.setFormula(', '.setFormulas(', '.setRichTextValue(',
  '.deleteRow(', '.deleteRows(', '.deleteColumn(', '.deleteColumns(',
  '.deleteSheet(', '.removeSheet(',
  '.insertCheckboxes(', '.removeCheckboxes(',
  '.insertRowBefore(', '.insertRowsBefore(', '.moveRows('
];

/* The only functions permitted to contain one. Most are the script's own
   write helpers; resolveEventTick_ and enforceExclusive_ answer a click
   the principal just made in the אירועים tab, where clearing the
   conflicting box IS the requested behaviour.

   rebuildScheduleGrid_ is the widest of them — it restates columns B, C
   and D of מערכת — and it is on this list only because styleSchedule_
   calls it behind a scheduleHasSubjects_() check. That guard is what
   keeps the write-safety rule true, so it is asserted on its own below,
   in "the B-D rebuild is reachable only through a no-subjects check". */
const MAY_WRITE = new Set([
  'writeHeader_', 'writeDayColumn_', 'seedIfEmpty_', 'rebuildScheduleGrid_',
  'resolveEventTick_', 'enforceExclusive_', 'convertTimeColumn_',
  'ensureSettingRows_'
]);

/* Blank out block comments, preserving every offset and newline, so the
   scan reads code and not prose. Without this the guard trips on
   ensureEventBoxes_'s own docstring, which mentions insertCheckboxes()
   precisely to explain why the script does NOT call it. */
function blankComments(src) {
  let out = src.split('');
  const re = /\/\*[\s\S]*?\*\//g;
  let m;
  while ((m = re.exec(src)) !== null) {
    for (let i = m.index; i < m.index + m[0].length; i++) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  }
  return out.join('');
}

/* Split the source into top-level functions by tracking brace depth, so
   each mutating call can be attributed to the function containing it. */
function functionSpans(src) {
  const spans = [];
  const re = /^function\s+([A-Za-z0-9_]+)\s*\(/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = src.indexOf('{', m.index);
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    spans.push({ name: m[1], start: m.index, end: i });
  }
  return spans;
}

function ownerOf(spans, index) {
  const hit = spans.filter((s) => index >= s.start && index <= s.end);
  return hit.length ? hit[hit.length - 1].name : '(top level)';
}

/* ---------- tests ---------- */

function run(test) {
  /* ============ 1. the headline claim ============ */

  test('setup on a populated sheet changes no cell contents', () => {
    const ss = populatedSheet();
    const before = snapshot(ss);
    const { ctx, env } = loadScript(ss);
    ctx.setup();
    const changes = diff(before, snapshot(ss));
    assert.deepEqual(changes, [],
      'setup() altered cell contents:\n  ' + changes.join('\n  '));
    /* "nothing changed" is also true of a run that died on its first
       call, so insist the run actually completed */
    const said = env.ss.toasts.map((t) => t.msg).join('\n');
    assert.ok(!/נכשלו/.test(said), 'setup() reported failures: ' + said);
  });

  test('setup on a populated sheet reports it styled rather than built', () => {
    const ss = populatedSheet();
    const { ctx, env } = loadScript(ss);
    ctx.setup();
    const said = env.ss.toasts.map((t) => t.msg).join('\n');
    assert.ok(/העיצוב והחוקים עודכנו/.test(said),
      'expected the "styled" report, got: ' + said);
    assert.ok(/התוכן שהוזן בגיליון לא השתנה/.test(said),
      'the report should say the content was left alone');
  });

  test('setup is idempotent — a second run also changes nothing', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const between = snapshot(ss);
    ctx.setup();
    const changes = diff(between, snapshot(ss));
    assert.deepEqual(changes, [],
      'the second run altered contents:\n  ' + changes.join('\n  '));
  });

  test('the only content write on a populated sheet is the day column', () => {
    const ss = populatedSheet();
    /* forget the writes that LOADED the fixture — we are auditing what
       setup() does, not what the test just did */
    ss.getSheets().forEach((sh) => { sh.writes.length = 0; });
    const { ctx } = loadScript(ss);
    ctx.setup();
    const writes = [];
    ss.getSheets().forEach((sh) => {
      sh.writes.forEach((w) => writes.push(sh.getName() + ' ' + w.a1));
    });
    /* Pinned exactly rather than allowlisted by pattern. Column A of
       מערכת is script-owned and re-stated every run; anything else
       appearing in this list is a regression, and the assertion names it. */
    assert.deepEqual(writes, ['מערכת A2:A77'],
      'unexpected write calls: ' + writes.join(', '));
  });

  test('the day column ends up merged, one block per day', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const sched = ss.getSheetByName('מערכת');
    /* fourteen rows per day except Friday (ו), which gets six and ends
       at row 77: א 2-15, ב 16-29, ג 30-43, ד 44-57, ה 58-71, ו 72-77 */
    assert.deepEqual(sched.merges,
      ['A2:A15', 'A16:A29', 'A30:A43', 'A44:A57', 'A58:A71', 'A72:A77'],
      'day blocks not merged as expected: ' + sched.merges.join(', '));
  });

  /* The specific hazard this fixture's shape exists to catch: setup.gs
     used to assume every day has PERIODS.length rows, which is false now
     that Friday ends after period 4. If that uniform-row assumption ever
     comes back — someone "simplifies" writeDayColumn_/styleSchedule_ back
     to `DAYS.length * PERIODS.length`, or drops SHORT_DAYS — Friday's
     block grows to 14 rows and every day's rows this closes must land at
     boundaries only reachable from PER-DAY counts, not a flat multiple. */
  test('per-day period counts are respected — Friday is short, the rest are not', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const sched = ss.getSheetByName('מערכת');
    const layout = scheduleLayout();

    DAYS.forEach((d, di) => {
      const expectedCount = d === 'ו' ? 6 : 14;
      assert.equal(layout.counts[di], expectedCount,
        `test fixture expected ${expectedCount} periods for ${d}, got ` +
        layout.counts[di]);

      const top = 2 + layout.offsets[di];
      const bottom = top + layout.counts[di] - 1;
      const block = `A${top}:A${bottom}`;
      assert.ok(sched.merges.indexOf(block) >= 0,
        `day ${d} should have been merged as ${block} — merges were: ` +
        sched.merges.join(', '));
    });

    assert.equal(layout.total, 76,
      'five fourteen-period days plus a six-period Friday should total 76 rows');
  });

  test('each merged block carries its letter once, blank below', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const sched = ss.getSheetByName('מערכת');
    const layout = scheduleLayout();
    DAYS.forEach((d, di) => {
      const top = 2 + layout.offsets[di];
      const count = layout.counts[di];
      assert.equal(sched.getRange(top, 1).getValue(), d,
        `block ${di} should start with ${d}`);
      for (let r = top + 1; r < top + count; r++) {
        assert.equal(sched.getRange(r, 1).getValue(), '',
          `row ${r} of the ${d} block should be blank`);
      }
    });
  });

  test('the day letter is 30pt and black', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const a2 = ss.getSheetByName('מערכת').getRange(2, 1);
    assert.equal(a2.getFontSize(), 30);
    assert.equal(a2.getFontColor(), '#000000');
  });

  test('an unmerged sheet is migrated without touching the subjects', () => {
    /* the shape a hand-typed sheet is in: the letter repeated on every
       row of each day, nothing merged */
    const ss = populatedSheet();
    const sched = ss.getSheetByName('מערכת');
    sched.merges.length = 0;
    const layout = scheduleLayout();
    DAYS.forEach((d, di) => {
      for (let i = 0; i < layout.counts[di]; i++) {
        sched.getRange(2 + layout.offsets[di] + i, 1).setValue(d);
      }
    });
    const subjectsBefore = sched.getRange(2, 5, TOTAL_ROWS, SCHED_COLS - 4).getValues();

    const { ctx } = loadScript(ss);
    ctx.setup();

    assert.equal(sched.merges.length, 6, 'the old shape was not merged');
    assert.equal(sched.getRange(2, 1).getValue(), 'א');
    assert.equal(sched.getRange(3, 1).getValue(), '',
      'the repeated letter was left behind under the merge');
    assert.deepEqual(sched.getRange(2, 5, TOTAL_ROWS, SCHED_COLS - 4).getValues(),
      subjectsBefore, 'migrating the day column disturbed the timetable');
  });

  /* ============ 1a. the new geometry: 1-14, rooms, split rows ======== */

  test('the header is sixteen columns: a subject and a room per grade', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    assert.deepEqual(ctx.scheduleHeaders_(), [
      'יום', 'שיעור', 'התחלה', 'סיום',
      'ז׳', 'ז׳ חדר', 'ח׳', 'ח׳ חדר', 'ט׳', 'ט׳ חדר',
      'י׳', 'י׳ חדר', 'י"א', 'י"א חדר', 'י"ב', 'י"ב חדר'
    ]);
    assert.equal(ctx.scheduleHeaders_().length, 16);
    ctx.setup();
    assert.deepEqual(
      ss.getSheetByName('מערכת').getRange(1, 1, 1, 16).getValues()[0],
      ctx.scheduleHeaders_(), 'the header row was not brought to 16 columns');
  });

  test('periods are 1 to 14 — there is no period 0 anywhere', () => {
    const ss = new Spreadsheet();
    const { ctx } = loadScript(ss);
    assert.deepEqual(ctx.PERIODS.map((p) => p[0]),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      'the period numbers are not 1-14');
    assert.equal(ctx.PERIODS[0][1], '08:15', 'the day starts at 08:15');
    assert.equal(ctx.PERIODS[13][2], '20:00', 'period 14 ends at 20:00');

    ctx.setup();
    const seeded = ss.getSheetByName('מערכת')
      .getRange(2, 2, TOTAL_ROWS, 1).getValues().map((r) => r[0]);
    assert.equal(seeded.filter((n) => Number(n) === 0).length, 0,
      'a period 0 row was seeded');
    assert.ok(seeded.every((n) => Number(n) >= 1 && Number(n) <= 14),
      'a seeded period number falls outside 1-14');
  });

  test('Friday runs periods 1-6, every other day 1-14', () => {
    const { ctx } = loadScript(new Spreadsheet());
    assert.equal(ctx.periodCount_('ו'), 6);
    ['א', 'ב', 'ג', 'ד', 'ה'].forEach(
      (d) => assert.equal(ctx.periodCount_(d), 14, 'day ' + d));
    const layout = ctx.scheduleLayout_();
    assert.equal(layout.total, 76);
    assert.deepEqual(layout.offsets, [0, 14, 28, 42, 56, 70]);
  });

  test('all four script-written columns are locked, under one protection', () => {
    const ss = populatedSheet();
    const sched = ss.getSheetByName('מערכת');
    /* a protection left behind by the version that locked only two
       columns — it must not survive alongside the new one */
    sched.getRange(2, 1, 60, 2).protect()
      .setDescription('יום ומספר שיעור — לא לשינוי');
    const { ctx } = loadScript(ss);
    ctx.setup();
    const own = sched.protections.filter(
      (p) => p.getRange().getSheet() === sched);
    const byDesc = {};
    own.forEach((p) => { byDesc[p.getDescription()] = p.getRange().getA1Notation(); });
    assert.equal(byDesc['יום, שיעור ושעות — לא לשינוי'], 'A2:D77',
      'the day, period and both time columns should be locked together');
    assert.ok(!('יום ומספר שיעור — לא לשינוי' in byDesc),
      'the previous version\'s protection was left behind over the same cells');
  });

  /* The point of the whole redesign: the principal adds a concurrent
     class by inserting a row under the lesson and filling in only that
     group's subject and room. Sheets grows the merged day block around
     it, and setup() must then work from the blocks AS THEY ARE — not
     from the 76-row grid the tab was seeded to. Getting this wrong moves
     day letters up the sheet and reassigns lessons to the wrong day
     without touching a single subject cell. */
  test('rows inserted for a split lesson survive a re-run', () => {
    const ss = populatedSheet();
    const sched = ss.getSheetByName('מערכת');
    /* three concurrent groups added to Sunday's period 2 (row 3), and
       one to Friday's period 1 (which then sits at row 76) */
    insertRowAt(sched, 4);
    insertRowAt(sched, 4);
    insertRowAt(sched, 4);
    sched.getRange(4, 5).setValue('אנגלית — קבוצה ב');
    sched.getRange(4, 6).setValue('חדר 9');
    sched.getRange(5, 5).setValue('אנגלית — קבוצה ג');
    sched.getRange(6, 15).setValue('פיזיקה 5 יח"ל');
    insertRowAt(sched, 76);
    sched.getRange(76, 7).setValue('של"ח');
    const before = snapshot(ss);
    sched.writes.length = 0;

    const { ctx, env } = loadScript(ss);
    ctx.setup();

    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(!/נכשלו/.test(said), 'setup() reported failures: ' + said);
    assert.deepEqual(diff(before, snapshot(ss)), [],
      'an inserted split row cost content');
    assert.deepEqual(sched.writes.map((w) => w.a1), ['A2:A81'],
      'the day column should be restated over the taller grid, and nothing ' +
      'else written: ' + sched.writes.map((w) => w.a1).join(', '));
    /* Sunday is three rows taller, Friday one — every later block moved */
    assert.deepEqual(sched.merges,
      ['A2:A18', 'A19:A32', 'A33:A46', 'A47:A60', 'A61:A74', 'A75:A81'],
      'day blocks not merged around the inserted rows: ' +
      sched.merges.join(', '));
    /* and the letters still sit on the first row of each block */
    assert.equal(sched.getRange(2, 1).getValue(), 'א');
    assert.equal(sched.getRange(19, 1).getValue(), 'ב');
    assert.equal(sched.getRange(75, 1).getValue(), 'ו');
    assert.equal(sched.getRange(4, 1).getValue(), '',
      'a split row must stay blank in the day column');
    assert.equal(sched.getRange(4, 5).getValue(), 'אנגלית — קבוצה ב',
      'the split row lost its subject');
  });

  test('a tab still on the previous geometry is refused, not overwritten', () => {
    const ss = oldShapeSheet();
    const sched = ss.getSheetByName('מערכת');
    const before = snapshot(ss);
    sched.writes.length = 0;

    const { ctx, env } = loadScript(ss);
    ctx.setup();

    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(/נכשלו/.test(said) && /מערכת/.test(said),
      'the old shape should be reported as a failure, got: ' + said);
    assert.ok(/מבנה ישן/.test(said), 'the report should say what is wrong');
    assert.deepEqual(sched.writes.map((w) => w.a1), [],
      'the old-shaped tab was written to: ' +
      sched.writes.map((w) => w.a1).join(', '));
    assert.deepEqual(diff(before, snapshot(ss)), [],
      'the old-shaped tab lost or gained content');
  });

  test('an EMPTY tab on the previous geometry is migrated, not refused', () => {
    const ss = oldShapeSheet();
    const sched = ss.getSheetByName('מערכת');
    /* the same old skeleton with nothing typed into it: there is no
       lesson to put under the wrong day, so rebuilding is safe */
    sched.getRange(2, 5, 60, GRADES.length).setValue('');
    const { ctx, env } = loadScript(ss);
    ctx.setup();
    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(!/נכשלו/.test(said), 'the empty old shape should migrate: ' + said);
    assert.deepEqual(sched.merges,
      ['A2:A15', 'A16:A29', 'A30:A43', 'A44:A57', 'A58:A71', 'A72:A77'],
      'the empty old shape was not rebuilt to 1-14: ' + sched.merges.join(', '));
  });

  /* ====== 1c. the half-migration: column A rebuilt, B-D left behind ====
     The bug, in one sentence: setup() decided a tab with no subjects was
     safe to migrate, restated column A to the new fourteen-row day
     blocks, and rebuilt NOTHING ELSE — so the old eleven-period grid's
     numbers and bell times stayed where they were, now under the wrong
     day letters. Version 0.199 shipped that; these tests are what keeps
     it from coming back.

     They assert the FULL grid, cell by cell, rather than the merges
     alone. Checking only column A was precisely the blind spot: column A
     was the one thing that WAS being rebuilt, so the older test above
     passed all the way through the bug. */

  /* The timetable skeleton as plain, comparable data: the day each row
     belongs to, its period number, and its two bell times as "HH:MM". */
  function readGrid(sched, rows) {
    const out = [];
    let day = '';
    for (let r = 2; r <= 1 + rows; r++) {
      const line = sched.getRange(r, 1, 1, 4).getValues()[0];
      if (String(line[0]).trim() !== '') day = String(line[0]).trim();
      out.push([day, line[1], hhmm(line[2]), hhmm(line[3])]);
    }
    return out;
  }

  /* The grid setup() is supposed to end up with: 1-14 every day, 1-6 on
     Friday. Built from the fixture's own PERIOD_TIMES rather than from
     setup.gs, so the two sides cannot be wrong together. */
  function expectedGrid() {
    const out = [];
    DAYS.forEach((day) => {
      for (let p = 0; p < periodCount(day); p++) {
        out.push([day, p + 1, hhmm(PERIOD_TIMES[p][0]), hhmm(PERIOD_TIMES[p][1])]);
      }
    });
    return out;
  }

  function hasSubjects(sched) {
    return sched.getRange(2, 5, TOTAL_ROWS, SCHED_COLS - 4).getValues()
      .some((row) => row.some((v) => String(v).trim() !== ''));
  }

  test('the fixture really is the broken sheet that was reported', () => {
    /* If this drifts, every assertion below is testing something else. */
    const sched = messedUpSheet().getSheetByName('מערכת');
    assert.deepEqual(sched.merges,
      ['A2:A15', 'A16:A29', 'A30:A43', 'A44:A57', 'A58:A71', 'A72:A77'],
      'the fixture should already carry the NEW 14-row day merges');
    assert.equal(sched.getRange(2, 2).getValue(), 0, 'row 2 should be period 0');
    assert.equal(sched.getRange(3, 2).getValue(), 1, 'row 3 should be period 1');
    assert.equal(sched.getRange(3, 3).getValue(), t('08:30'),
      'row 3 should carry the OLD 08:30 start');
    assert.equal(sched.getRange(12, 2).getValue(), 10, 'row 12 should be period 10');
    assert.equal(sched.getRange(13, 2).getValue(), 0,
      'row 13 should be a second period 0 — the old ב block, sitting ' +
      'inside the new א block');
    assert.equal(sched.getRange(62, 2).getValue(), '',
      'the old sixty-row grid should stop short of the new one');
    assert.equal(hasSubjects(sched), false,
      'the fixture must hold no subject at all — that is what made ' +
      'setup() think it could migrate');
  });

  test('re-running setup repairs the half-migrated grid, row by row', () => {
    const ss = messedUpSheet();
    const sched = ss.getSheetByName('מערכת');
    const { ctx, env } = loadScript(ss);
    ctx.setup();

    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(!/נכשלו/.test(said), 'setup() reported failures: ' + said);
    /* every row: right day, right period number, right bell times */
    assert.deepEqual(readGrid(sched, TOTAL_ROWS), expectedGrid(),
      'the grid was not rebuilt to the 1-14 schedule');
  });

  test('the repaired grid has no period 0 and no old bell time left', () => {
    const ss = messedUpSheet();
    const sched = ss.getSheetByName('מערכת');
    const { ctx } = loadScript(ss);
    ctx.setup();

    const nums = sched.getRange(2, 2, TOTAL_ROWS, 1).getValues().map((r) => r[0]);
    assert.equal(nums.filter((n) => Number(n) === 0).length, 0,
      'a period 0 row survived the rebuild');
    assert.ok(nums.every((n) => Number(n) >= 1 && Number(n) <= 14),
      'a period number outside 1-14 survived the rebuild');

    /* 08:30 was the old period 0's end and the old period 1's start; it
       is neither in the new table */
    const starts = sched.getRange(2, 3, TOTAL_ROWS, 1).getValues().map((r) => r[0]);
    const ends = sched.getRange(2, 4, TOTAL_ROWS, 1).getValues().map((r) => r[0]);
    assert.ok(starts.every((v) => v !== t('08:30')),
      'the old 08:30 period-1 start is still in the sheet');
    assert.ok(ends.every((v) => v !== t('08:30')),
      'the old 08:30 period-0 end is still in the sheet');
    assert.equal(sched.getRange(2, 3).getValue(), t('08:15'), 'row 2 starts 08:15');
    assert.equal(sched.getRange(2, 4).getValue(), t('09:00'), 'row 2 ends 09:00');
  });

  test('Friday is rebuilt to periods 1-6 and the tab stops at row 77', () => {
    const ss = messedUpSheet();
    const sched = ss.getSheetByName('מערכת');
    const { ctx } = loadScript(ss);
    ctx.setup();

    assert.equal(sched.getRange(72, 1).getValue(), 'ו');
    for (let i = 0; i < 6; i++) {
      assert.equal(sched.getRange(72 + i, 2).getValue(), i + 1,
        'Friday row ' + (72 + i) + ' should be period ' + (i + 1));
    }
    assert.equal(sched.getRange(77, 4).getValue(), t('13:30'),
      'Friday should end at 13:30');
    assert.equal(sched.getLastRow(), 77,
      'the timetable should stop at row 77, nothing below it');
  });

  test('the repaired grid is merged, lettered and locked correctly', () => {
    const ss = messedUpSheet();
    const sched = ss.getSheetByName('מערכת');
    const { ctx } = loadScript(ss);
    ctx.setup();

    assert.deepEqual(sched.merges,
      ['A2:A15', 'A16:A29', 'A30:A43', 'A44:A57', 'A58:A71', 'A72:A77'],
      'day blocks not merged as expected: ' + sched.merges.join(', '));
    const layout = scheduleLayout();
    DAYS.forEach((d, di) => {
      const top = 2 + layout.offsets[di];
      assert.equal(sched.getRange(top, 1).getValue(), d);
      for (let r = top + 1; r < top + layout.counts[di]; r++) {
        assert.equal(sched.getRange(r, 1).getValue(), '',
          'row ' + r + ' should be blank under the ' + d + ' merge');
      }
    });
    const byDesc = {};
    sched.protections.forEach((pr) => {
      byDesc[pr.getDescription()] = pr.getRange().getA1Notation();
    });
    assert.equal(byDesc['יום, שיעור ושעות — לא לשינוי'], 'A2:D77',
      'the rebuilt skeleton was not locked across A-D');
    assert.deepEqual(sched.getRange(1, 1, 1, SCHED_COLS).getValues()[0],
      SCHED_HEADERS, 'the header was not brought to sixteen columns');
  });

  test('no stray old value is left anywhere in the tab', () => {
    const ss = messedUpSheet();
    const sched = ss.getSheetByName('מערכת');
    const { ctx } = loadScript(ss);
    ctx.setup();

    /* The grade columns of the grid, still completely empty. The old grid
       kept its subjects at E-J, which are now ז׳, ז׳ חדר, ח׳ … — so
       anything surviving there would be under the wrong grade as well as
       the wrong period. */
    assert.equal(hasSubjects(sched), false,
      'the rebuild invented content in the grade columns');
    /* and the whole sheet below the grid, across every column it has */
    for (let r = 78; r <= sched.getMaxRows(); r++) {
      for (let c = 1; c <= sched.getMaxColumns(); c++) {
        assert.equal(sched.getRange(r, c).getValue(), '',
          'row ' + r + ' column ' + c + ' still holds something');
      }
    }
  });

  test('a taller old grid leaves nothing below the new one', () => {
    /* The other direction: an old shape running PAST row 77. Its trailing
       rows are stale skeleton and must go, or the board reads phantom
       lessons under a seventh day letter. */
    const ss = clearedOldGridSheet();
    const sched = ss.getSheetByName('מערכת');
    sched.getRange(80, 1, 1, 4).setValues([['ו', 9, t('16:15'), t('17:00')]]);
    sched.getRange(85, 2).setValue(11);
    const { ctx, env } = loadScript(ss);
    ctx.setup();

    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(!/נכשלו/.test(said), 'setup() reported failures: ' + said);
    assert.equal(sched.getLastRow(), 77,
      'rows past the new grid survived: last row is ' + sched.getLastRow());
    assert.deepEqual(readGrid(sched, TOTAL_ROWS), expectedGrid(),
      'the grid was not rebuilt to the 1-14 schedule');
  });

  test('blank inserted rows are reset too, not kept as a taller geometry', () => {
    /* The reason scheduleHasSubjects_ is asked FIRST, before the blocks
       are read back. A row inserted for a concurrent class earns its keep
       only by holding a lesson; on a tab where everything has been
       cleared, keeping the taller blocks would mean writing 76 rows of
       period numbers under 78 rows of day letters — the same mismatch,
       one row at a time. Nothing typed here, so reset the lot. */
    const ss = populatedSheet();
    const sched = ss.getSheetByName('מערכת');
    sched.getRange(2, 5, TOTAL_ROWS, SCHED_COLS - 4).setValue('');
    insertRowAt(sched, 4);
    insertRowAt(sched, 4);
    assert.equal(sched.merges[0], 'A2:A17', 'the fixture should be two rows taller');

    const { ctx, env } = loadScript(ss);
    ctx.setup();

    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(!/נכשלו/.test(said), 'setup() reported failures: ' + said);
    assert.deepEqual(sched.merges,
      ['A2:A15', 'A16:A29', 'A30:A43', 'A44:A57', 'A58:A71', 'A72:A77'],
      'the empty taller grid was not reset: ' + sched.merges.join(', '));
    assert.deepEqual(readGrid(sched, TOTAL_ROWS), expectedGrid(),
      'the grid was not rebuilt to the 1-14 schedule');
    assert.equal(sched.getLastRow(), 77,
      'the extra rows were left below the grid: last row is ' +
      sched.getLastRow());
  });

  test('the pre-run state — old merges, old grid, no subjects — repairs too', () => {
    /* The same tab one step earlier, before 0.199 ever touched it, so
       column A still carries the OLD eleven-row blocks. Both states must
       end up in the same place, or "just run setup() again" is only true
       for one of them. */
    const ss = clearedOldGridSheet();
    const sched = ss.getSheetByName('מערכת');
    assert.deepEqual(sched.merges,
      ['A2:A12', 'A13:A23', 'A24:A34', 'A35:A45', 'A46:A56', 'A57:A61'],
      'the fixture should carry the OLD 11-row day merges');
    const { ctx, env } = loadScript(ss);
    ctx.setup();

    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(!/נכשלו/.test(said), 'setup() reported failures: ' + said);
    assert.deepEqual(readGrid(sched, TOTAL_ROWS), expectedGrid(),
      'the grid was not rebuilt to the 1-14 schedule');
    assert.deepEqual(sched.merges,
      ['A2:A15', 'A16:A29', 'A30:A43', 'A44:A57', 'A58:A71', 'A72:A77'],
      'day blocks not merged as expected: ' + sched.merges.join(', '));
  });

  test('repairing is idempotent — a second run writes only the day column', () => {
    const ss = messedUpSheet();
    const sched = ss.getSheetByName('מערכת');
    const { ctx } = loadScript(ss);
    ctx.setup();
    const between = snapshot(ss);
    sched.writes.length = 0;
    ctx.setup();
    const changes = diff(between, snapshot(ss));
    assert.deepEqual(changes, [],
      'the second run changed content:\n  ' + changes.join('\n  '));
    assert.deepEqual(sched.writes.map((w) => w.a1), ['A2:A77'],
      'the rebuild wrote again over an already-correct grid: ' +
      sched.writes.map((w) => w.a1).join(', '));
  });

  /* ---- the three ways 0.200 passed every test above and still failed
     on the school's sheet. Each of these fails without its own line of
     0.201, and the first of them fails with the message the principal
     actually saw. ---- */

  test('the half-migrated tab has a day block hanging below its content', () => {
    /* The property that broke the live run, pinned so a tidied fixture
       cannot quietly remove it: the last merged block runs A72:A77 while
       the last row holding anything is 72. scheduleLastRow_ therefore
       answers 72, and a breakApart() over A2:A72 ends INSIDE a merge —
       which Sheets rejects, at the next flush, out of reach of the
       try/catch that was around the call. */
    const sched = messedUpSheet().getSheetByName('מערכת');
    assert.equal(sched.merges[sched.merges.length - 1], 'A72:A77');
    assert.equal(sched.getLastRow(), 72,
      'the last row with content should be 72, five rows above the ' +
      'bottom of the last merged block');
  });

  test('the day column is unmerged one block at a time, never mid-block', () => {
    /* Same tab, with the leftover block made taller still, so a rebuild
       that reasons from row counts instead of from the merges themselves
       cannot pass by luck. */
    const ss = messedUpSheet();
    const sched = ss.getSheetByName('מערכת');
    sched.merges[sched.merges.length - 1] = 'A72:A90';
    const { ctx, env } = loadScript(ss);
    ctx.setup();

    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(!/נכשלו/.test(said), 'setup() reported failures: ' + said);
    assert.deepEqual(sched.merges,
      ['A2:A15', 'A16:A29', 'A30:A43', 'A44:A57', 'A58:A71', 'A72:A77'],
      'day blocks not merged as expected: ' + sched.merges.join(', '));
    assert.deepEqual(readGrid(sched, TOTAL_ROWS), expectedGrid(),
      'the grid was not rebuilt to the 1-14 schedule');
  });

  test('a Date in the time columns is the same bell, not a difference', () => {
    /* getValues() on a real time-formatted cell returns a Date on the
       spreadsheet epoch, not the fraction this mock stores. 0.200
       compared it via String(), never matched, and rewrote all 228 cells
       on every run — invisible here because nothing ever produced a
       Date. Produce one, and pin the write count. */
    const ss = messedUpSheet();
    const sched = ss.getSheetByName('מערכת');
    const { ctx } = loadScript(ss);
    ctx.setup();
    for (let r = 2; r <= TOTAL_ROWS + 1; r++) {
      [3, 4].forEach((c) => {
        const v = sched.values[r - 1][c - 1];
        if (typeof v !== 'number') return;
        const mins = Math.round(v * 1440);
        sched.values[r - 1][c - 1] =
          new Date(1899, 11, 30, Math.floor(mins / 60), mins % 60);
      });
    }
    sched.writes.length = 0;
    ctx.setup();
    assert.deepEqual(sched.writes.map((w) => w.a1), ['A2:A77'],
      'a grid whose times came back as Dates was treated as wrong and ' +
      'rewritten: ' + sched.writes.map((w) => w.a1).join(', '));
  });

  test('a rebuild that silently does not take is reported, not celebrated', () => {
    /* The whole point of 0.201: correctness is READ BACK. Make the one
       write vanish — the shape of every "the call was made and nothing
       happened" failure — and setup() must say so, in Hebrew, naming the
       tab, rather than reporting a successful run over the old grid. */
    const ss = messedUpSheet();
    const sched = ss.getSheetByName('מערכת');
    const realGetRange = sched.getRange.bind(sched);
    sched.getRange = function (...args) {
      const r = realGetRange(...args);
      if (r.getA1Notation() === 'B2:D77') r.setValues = () => r;
      return r;
    };
    const { ctx, env } = loadScript(ss);
    ctx.setup();

    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(/נכשלו/.test(said),
      'a rebuild that did nothing was reported as a success: ' + said);
    assert.ok(/מערכת/.test(said), 'the failure did not name the tab: ' + said);
    assert.ok(/לא נקלטה/.test(said),
      'the failure did not say the rebuild never landed: ' + said);
    assert.ok(/שורה 2/.test(said),
      'the failure did not say which row is wrong: ' + said);
  });

  test('a merge that never happens is caught by the read-back, not shipped', () => {
    /* rebuildScheduleGrid_ checks its own three columns; the day letters
       and the merged blocks are written after it, by writeDayColumn_, and
       are checked at the very end of the tab's style pass. Take the merge
       away and the run must fail loudly — the state it would otherwise
       report as a success is a timetable the board groups wrongly. */
    const ss = messedUpSheet();
    const sched = ss.getSheetByName('מערכת');
    const realGetRange = sched.getRange.bind(sched);
    sched.getRange = function (...args) {
      const r = realGetRange(...args);
      if (/^A\d+:A\d+$/.test(r.getA1Notation())) r.merge = () => r;
      return r;
    };
    const { ctx, env } = loadScript(ss);
    ctx.setup();

    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(/נכשלו/.test(said),
      'an unmerged day column was reported as a success: ' + said);
    assert.ok(/מיזוג/.test(said),
      'the failure did not say the merges are wrong: ' + said);
  });

  test('a stray taller day block on a LIVE tab does not fail the run', () => {
    /* Same trap as the empty tab's, on the path that carries the
       school's timetable: writeDayColumn_ takes its height from the day
       letters, so a merged block reaching BELOW the last lesson leaves
       its range ending mid-merge. Nothing may be written to B-P here —
       there are subjects — and the run must still finish. */
    const ss = populatedSheet();
    const sched = ss.getSheetByName('מערכת');
    sched.merges[sched.merges.length - 1] = 'A72:A85';   /* ו, five too tall */
    const before = snapshot(ss);
    const { ctx, env } = loadScript(ss);
    ctx.setup();

    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(!/נכשלו/.test(said), 'setup() reported failures: ' + said);
    assert.deepEqual(diff(before, snapshot(ss)), [],
      'a populated tab lost or gained content');
    assert.deepEqual(sched.merges,
      ['A2:A15', 'A16:A29', 'A30:A43', 'A44:A57', 'A58:A71', 'A72:A77'],
      'the oversized block was not put right: ' + sched.merges.join(', '));
  });

  test('the toast says the מערכת grid was rebuilt, then that it was verified', () => {
    const ss = messedUpSheet();
    const { ctx, env } = loadScript(ss);
    ctx.setup();
    assert.ok(/מערכת: הלוח נבנה מחדש ואומת/.test(
      env.ss.toasts.map((tt) => tt.msg).join('\n')),
      'the first run did not report a rebuild: ' +
      env.ss.toasts.map((tt) => tt.msg).join('\n'));

    env.ss.toasts.length = 0;
    ctx.setup();
    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(/מערכת: הלוח נבדק ואומת/.test(said),
      'the second run did not report a verification: ' + said);
  });

  /* ====== 1d. the write-safety rule the repair is allowed under ======
     "setup() writes the מערכת tab's columns A-D only while the tab holds
     no subject and no room; with one present it writes column A alone,
     and refuses the tab outright when the geometry under those subjects
     is an older, shorter one."

     Both halves are load-bearing: without the first the sheet cannot be
     repaired at all, and without the second the repair could move
     somebody's timetable. */

  test('with subjects present, B-D are never written — even when wrong', () => {
    const ss = populatedSheet();
    const sched = ss.getSheetByName('מערכת');
    /* a period number and a start time that are simply wrong */
    sched.getRange(5, 2).setValue(99);
    sched.getRange(5, 3).setValue(t('03:00'));
    const before = snapshot(ss);
    sched.writes.length = 0;

    const { ctx, env } = loadScript(ss);
    ctx.setup();

    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(!/נכשלו/.test(said), 'setup() reported failures: ' + said);
    assert.deepEqual(sched.writes.map((w) => w.a1), ['A2:A77'],
      'setup wrote outside the day column on a tab holding subjects: ' +
      sched.writes.map((w) => w.a1).join(', '));
    assert.equal(sched.getRange(5, 2).getValue(), 99,
      'the odd period number was overwritten — the rebuild reached a tab ' +
      'that holds real content');
    assert.deepEqual(diff(before, snapshot(ss)), [], 'content changed');
  });

  test('one subject is enough to stop the rebuild and refuse an old grid', () => {
    /* The boundary: the SAME broken tab with a single lesson typed back
       into it. Rebuilding B-D would put that lesson under the wrong
       period, so setup() must refuse the tab instead. */
    const ss = messedUpSheet();
    const sched = ss.getSheetByName('מערכת');
    sched.getRange(9, 5).setValue('מתמטיקה');
    const before = snapshot(ss);
    sched.writes.length = 0;

    const { ctx, env } = loadScript(ss);
    ctx.setup();

    const said = env.ss.toasts.map((tt) => tt.msg).join('\n');
    assert.ok(/נכשלו/.test(said) && /מערכת/.test(said),
      'a single subject over a broken grid should be refused, got: ' + said);
    assert.deepEqual(sched.writes.map((w) => w.a1), [],
      'the tab was written to anyway: ' +
      sched.writes.map((w) => w.a1).join(', '));
    assert.deepEqual(diff(before, snapshot(ss)), [], 'content changed');
  });

  test('a room with no subject beside it also counts as content', () => {
    const ss = messedUpSheet();
    const sched = ss.getSheetByName('מערכת');
    sched.getRange(9, 6).setValue('חדר 12');       /* ז׳ חדר, no subject */
    sched.writes.length = 0;
    const { ctx } = loadScript(ss);
    ctx.setup();
    assert.deepEqual(sched.writes.map((w) => w.a1), [],
      'a lone room did not stop the rebuild: ' +
      sched.writes.map((w) => w.a1).join(', '));
    assert.equal(sched.getRange(9, 6).getValue(), 'חדר 12');
  });

  test('the B-D rebuild is reachable only through a no-subjects check', () => {
    /* Structural, not behavioural. rebuildScheduleGrid_ is on the write
       allowlist, so nothing else in the guard would notice if a later
       edit called it unconditionally — which would hand setup() the power
       to restate the period and time columns of a live timetable. Pin the
       call site instead. */
    const code = blankComments(SOURCE);
    const spans = functionSpans(code);
    const calls = [];
    let i = -1;
    while ((i = code.indexOf('rebuildScheduleGrid_(', i + 1)) !== -1) {
      const span = spans.filter((sp) => i >= sp.start && i <= sp.end).pop();
      if (span && span.name === 'rebuildScheduleGrid_') continue;   /* the definition */
      calls.push({ owner: span ? span.name : '(top level)',
                   line: code.slice(0, i).split('\n').pop() });
    }
    assert.equal(calls.length, 1,
      'rebuildScheduleGrid_ should have exactly one call site, found ' +
      calls.length + ': ' + calls.map((c) => c.owner).join(', '));
    assert.equal(calls[0].owner, 'styleSchedule_',
      'the rebuild moved out of styleSchedule_');
    assert.ok(/if\s*\(\s*!\s*scheduleHasSubjects_\(sh\)\s*\)\s*$/
                .test(calls[0].line),
      'the rebuild must be guarded by !scheduleHasSubjects_(sh) on its ' +
      'own line — found: ' + calls[0].line.trim());
  });

  /* ============ 1b. the locale, which decides how dates are READ ====== */

  test('setup lands the sheet in a Hebrew locale', () => {
    const ss = populatedSheet();
    assert.equal(ss.locale, 'en_US', 'fixture should start American');
    const { ctx } = loadScript(ss);
    ctx.setup();
    assert.ok(/^iw/.test(ss.locale),
      'locale is "' + ss.locale + '" — dates will be read in the wrong ' +
      'order (01/09 as 9 January)');
  });

  test('the ignored "he_IL" code alone would not have worked', () => {
    /* guards the fallback chain: if someone "tidies" it down to the
       modern spelling, this fails instead of the school's dates */
    const ss = populatedSheet();
    ss.setSpreadsheetLocale('he_IL');
    assert.equal(ss.locale, 'en_US',
      'the mock should ignore he_IL, as Sheets does');
  });

  test('a non-Hebrew locale produces a visible warning', () => {
    const { ctx } = loadScript(new Spreadsheet());
    assert.ok(/^$/.test(ctx.localeNote_('iw_IL')), 'no warning when Hebrew');
    const warn = ctx.localeNote_('en_US');
    assert.ok(/en_US/.test(warn) && /ינואר/.test(warn),
      'the warning should name the locale and the consequence');
  });

  /* ============ 2. the specific traps ============ */

  test('grade ticks in אירועים survive the checkbox pass', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const ev = ss.getSheetByName('אירועים');
    /* row 2: ז׳ and ח׳ ticked; row 3: כולם ticked; row 4: ט׳ and י"ב */
    assert.equal(ev.getRange(2, 6).getValue(), true, 'ז׳ tick lost');
    assert.equal(ev.getRange(2, 7).getValue(), true, 'ח׳ tick lost');
    assert.equal(ev.getRange(3, 12).getValue(), true, 'כולם tick lost');
    assert.equal(ev.getRange(4, 8).getValue(), true, 'ט׳ tick lost');
    assert.equal(ev.getRange(4, 11).getValue(), true, 'י"ב tick lost');
    /* and the empty ones stay EMPTY, not FALSE — false would export into
       the CSV the board reads every minute */
    assert.equal(ev.getRange(2, 8).getValue(), '', 'an unticked box became FALSE');
  });

  test('a chosen theme is not reset to the default', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    assert.equal(ss.getSheetByName('הגדרות').getRange(2, 2).getValue(), 'בהירה');
  });

  test('an out-of-window exam date is left in place, not scrubbed', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    /* row 3 holds a date from 2025 — far outside the new validation
       window. Validation governs the NEXT entry, never the current one. */
    const v = ss.getSheetByName('מבחנים').getRange(3, 1).getValue();
    assert.ok(v instanceof Date && v.getFullYear() === 2025,
      'the stale date was altered: ' + v);
  });

  test('an over-length subject is left in place, not truncated', () => {
    const ss = populatedSheet();
    const before =
      ss.getSheetByName('מערכת').getRange(2, 1, TOTAL_ROWS, SCHED_COLS).getValues();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const after =
      ss.getSheetByName('מערכת').getRange(2, 1, TOTAL_ROWS, SCHED_COLS).getValues();
    assert.deepEqual(after, before);
  });

  /* ============ 3. styling really did happen ============ */

  test('the style pass reaches the data rows', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const sched = ss.getSheetByName('מערכת');
    /* grade tint on a cell deep in the timetable, not just the header */
    assert.equal(sched.getRange(40, 5).getBackground(), '#d9ead3',
      'the ז׳ subject column tint did not reach row 40');
    assert.equal(sched.getRange(40, 6).getBackground(), '#d9ead3',
      'the ז׳ ROOM column should carry the same tint as its subject');
    assert.equal(sched.getRange(77, 15).getBackground(), '#d0e0e3',
      'the י"ב column tint did not reach the last row');
    assert.equal(sched.getRange(77, 16).getBackground(), '#d0e0e3',
      'the י"ב room column tint did not reach the last row');
    /* the room reads as an annotation: smaller and grey, not a subject */
    assert.equal(sched.getRange(40, 6).getFontColor(), '#666666');
    assert.notEqual(sched.getRange(40, 5).getFontColor(), '#666666',
      'the subject itself must not be dimmed');
    /* all four locked columns are greyed all the way down */
    [1, 2, 3, 4].forEach((c) => assert.equal(
      sched.getRange(77, c).getBackground(), '#f0f0f0',
      'column ' + c + ' should be greyed as a locked column'));
    /* six thick day boxes were drawn */
    assert.ok(sched.borders.length >= 7,
      'expected the day boxes, saw ' + sched.borders.length + ' border calls');
  });

  test('validation is applied to data rows that already hold content', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const exams = ss.getSheetByName('מבחנים');
    assert.ok(exams.getRange(2, 1).getDataValidation(),
      'no date rule on the first exam row');
    assert.ok(exams.getRange(2, 2).getDataValidation(),
      'no grade dropdown on the first exam row');
    const ev = ss.getSheetByName('אירועים');
    assert.equal(ev.getRange(2, 6).getDataValidation().getCriteriaType(),
      'CHECKBOX', 'the tick cell lost its checkbox');
  });

  test('re-running does not stack duplicate conditional format rules', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const once = ss.getSheetByName('מבחנים').getConditionalFormatRules().length;
    ctx.setup();
    const twice = ss.getSheetByName('מבחנים').getConditionalFormatRules().length;
    assert.equal(twice, once,
      `conditional format rules grew from ${once} to ${twice}`);
  });

  test('re-running does not stack duplicate protections', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const once = ss.getSheetByName('מערכת').protections.length;
    ctx.setup();
    const twice = ss.getSheetByName('מערכת').protections.length;
    assert.equal(twice, once,
      `protections grew from ${once} to ${twice}`);
  });

  /* ============ 4. the empty-sheet path still works ============ */

  test('setup on an empty spreadsheet builds and seeds every tab', () => {
    const ss = new Spreadsheet();
    const { ctx, env } = loadScript(ss);
    ctx.setup();
    const names = ss.getSheets().map((s) => s.getName());
    ['מערכת', 'מבחנים', 'אירועים', 'הודעות', 'הגדרות'].forEach((n) => {
      assert.ok(names.indexOf(n) >= 0, 'missing tab ' + n);
      assert.ok(ss.getSheetByName(n).getLastRow() >= 2,
        'tab ' + n + ' was not seeded');
    });
    assert.equal(ss.getSheetByName('מערכת').getLastRow(), 77,
      'the timetable should be 76 rows plus a header');
    const said = env.ss.toasts.map((t) => t.msg).join('\n');
    assert.ok(/הגיליון נבנה בהצלחה/.test(said),
      'expected the first-build report, got: ' + said);
  });

  test('a half-filled sheet is seeded only where it is empty', () => {
    const ss = new Spreadsheet();
    /* the principal typed the timetable but nothing else yet */
    const sched = ss.addSheet('מערכת');
    sched.getRange(1, 1, 1, SCHED_COLS).setValues([SCHED_HEADERS]);
    const only = ['א', 1, t('08:15'), t('09:00'), 'מתמטיקה', 'חדר 12'];
    while (only.length < SCHED_COLS) only.push('');
    sched.getRange(2, 1, 1, SCHED_COLS).setValues([only]);
    sched.writes.length = 0;
    const { ctx } = loadScript(ss);
    ctx.setup();
    /* The one typed lesson survives, and no example rows were pasted over
       it — that is what "seeded only where empty" has to mean. It cannot
       mean "the sheet is untouched": column A is script-owned, so setup
       restates the day skeleton there whatever else is going on. */
    assert.equal(sched.getRange(2, 5).getValue(), 'מתמטיקה');
    assert.equal(sched.getRange(3, 5).getValue(), '',
      'an example row was seeded into a tab that already had content');
    assert.deepEqual(sched.writes.map((w) => w.a1), ['A2:A77'],
      'setup wrote outside the day column: ' +
      sched.writes.map((w) => w.a1).join(', '));
    /* but the empty tabs did get their examples */
    assert.ok(ss.getSheetByName('הודעות').getLastRow() >= 2);
  });

  test('seedIfEmpty_ refuses a tab holding a single stray cell', () => {
    const ss = new Spreadsheet();
    const sh = ss.addSheet('הודעות');
    sh.getRange(9, 3).setValue('הערה של מישהו');
    const { ctx } = loadScript(ss);
    const seeded = ctx.seedIfEmpty_(sh, [['a', 'b', 'c', 'd']]);
    assert.equal(seeded, false, 'seeded over an occupied tab');
    assert.equal(sh.getRange(9, 3).getValue(), 'הערה של מישהו');
    assert.equal(sh.getRange(2, 1).getValue(), '');
  });

  /* ============ 4b. times are real time values, shown HH:MM ========== */

  test('timeValue_ reads the forms a person types', () => {
    const { ctx } = loadScript(new Spreadsheet());
    assert.equal(ctx.timeValue_('8:50'), 530 / 1440);
    assert.equal(ctx.timeValue_('08:50'), 530 / 1440);
    assert.equal(ctx.timeValue_('8.50'), 530 / 1440, 'a dot is ordinary here');
    assert.equal(ctx.timeValue_('0:00'), 0);
    assert.equal(ctx.timeValue_('23:59'), 1439 / 1440);
  });

  test('timeValue_ leaves alone anything that is not a time', () => {
    const { ctx } = loadScript(new Spreadsheet());
    [ '', null, undefined, 'מתמטיקה', '25:00', '8:70', '8', 'בערך 8:50',
      0.5 /* already a time value */ ].forEach((v) => {
      assert.equal(ctx.timeValue_(v), null, 'should not have converted ' + v);
    });
  });

  test('text times left by the old scheme are converted once', () => {
    const ss = populatedSheet();
    const sched = ss.getSheetByName('מערכת');
    /* the shape the sheet is in today: times stored as plain text */
    sched.getRange(2, 3).setValue('8:00');
    sched.getRange(2, 4).setValue('08:45');
    const { ctx } = loadScript(ss);
    ctx.setup();
    assert.equal(sched.getRange(2, 3).getValue(), 480 / 1440,
      '8:00 was not converted to a time value');
    assert.equal(sched.getRange(2, 4).getValue(), 525 / 1440);
  });

  test('the time columns carry an hh:mm format', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const fmt = ss.getSheetByName('מערכת').format.numberFormat || {};
    assert.equal(fmt['2,3'], 'hh:mm', 'התחלה is not formatted as a time');
    assert.equal(fmt['2,4'], 'hh:mm', 'סיום is not formatted as a time');
    const ex = ss.getSheetByName('מבחנים').format.numberFormat || {};
    assert.equal(ex['2,4'], 'hh:mm');
    assert.equal(ex['2,5'], 'hh:mm');
  });

  test('converting times is idempotent — a second run rewrites nothing', () => {
    const ss = populatedSheet();
    const sched = ss.getSheetByName('מערכת');
    sched.getRange(2, 3).setValue('8:00');      /* force one conversion */
    const { ctx } = loadScript(ss);
    ctx.setup();
    ss.getSheets().forEach((sh) => { sh.writes.length = 0; });
    ctx.setup();
    const writes = [];
    ss.getSheets().forEach((sh) => {
      sh.writes.forEach((w) => writes.push(sh.getName() + ' ' + w.a1));
    });
    assert.deepEqual(writes, ['מערכת A2:A77'],
      'the second run rewrote time columns: ' + writes.join(', '));
  });

  /* ============ 4c. a setting added after the sheet was built ======== */

  test('a missing setting row is appended, existing choices untouched', () => {
    const ss = populatedSheet();
    const set = ss.getSheetByName('הגדרות');
    /* the shape every existing sheet is in: theme only */
    set.getRange(3, 1, 1, 2).setValue('');
    set.getRange(3, 1).setValue('');
    set.getRange(3, 2).setValue('');
    const { ctx } = loadScript(ss);
    ctx.setup();
    assert.equal(set.getRange(2, 1).getValue(), 'ערכת נושא');
    assert.equal(set.getRange(2, 2).getValue(), 'בהירה',
      'the chosen theme was overwritten');
    assert.equal(set.getRange(3, 1).getValue(), 'אופן הצגת שיעורים',
      'the new setting row was not appended');
    assert.ok(String(set.getRange(3, 2).getValue()).indexOf('הצג') === 0,
      'the new row has no default value');
  });

  test('a choice already made for the new setting is never rewritten', () => {
    const ss = populatedSheet();
    const set = ss.getSheetByName('הגדרות');
    const before = set.getRange(3, 2).getValue();
    set.writes.length = 0;
    const { ctx } = loadScript(ss);
    ctx.setup();
    assert.equal(set.getRange(3, 2).getValue(), before);
    assert.deepEqual(set.writes.map((w) => w.a1), [],
      'setup wrote to הגדרות when both rows already existed');
  });

  test('each settings row gets the dropdown for ITS OWN setting', () => {
    const ss = populatedSheet();
    const { ctx } = loadScript(ss);
    ctx.setup();
    const set = ss.getSheetByName('הגדרות');
    const theme = set.getRange(2, 2).getDataValidation();
    const lesson = set.getRange(3, 2).getDataValidation();
    assert.ok(theme && lesson, 'a settings row has no dropdown');
    const themeOpts = theme.getCriteriaValues()[0];
    const lessonOpts = lesson.getCriteriaValues()[0];
    assert.ok(themeOpts.indexOf('כהה') >= 0, 'row 2 is not the theme list');
    assert.ok(lessonOpts.indexOf('הצג את כל השיעורים ביום') >= 0,
      'row 3 is not the lesson-view list');
    assert.ok(lessonOpts.indexOf('כהה') < 0,
      'row 3 got the theme list — the old whole-column rule is back');
  });

  /* ============ 5. the structural guard ============ */

  test('no content-mutating call outside the write helpers', () => {
    const code = blankComments(SOURCE);
    const spans = functionSpans(code);
    const offenders = [];
    MUTATORS.forEach((token) => {
      let i = -1;
      while ((i = code.indexOf(token, i + 1)) !== -1) {
        const owner = ownerOf(spans, i);
        if (MAY_WRITE.has(owner)) continue;
        const line = SOURCE.slice(0, i).split('\n').length;
        offenders.push(`${token} in ${owner}() at setup.gs:${line}`);
      }
    });
    assert.deepEqual(offenders, [],
      'content-mutating calls outside the allowed helpers:\n  ' +
      offenders.join('\n  '));
  });

  test('every function named in the write allowlist still exists', () => {
    const spans = functionSpans(SOURCE);
    const names = new Set(spans.map((s) => s.name));
    MAY_WRITE.forEach((n) => {
      assert.ok(names.has(n),
        'the allowlist names ' + n + '(), which no longer exists — ' +
        'if it was renamed, update MAY_WRITE so the guard keeps biting');
    });
  });

  test('the write helpers are the only callers of seedIfEmpty_ contents', () => {
    /* seedIfEmpty_ must keep BOTH of its guards: a missing one would let
       a re-run overwrite a populated tab and no other test would notice,
       because the mock sheet is either clearly empty or clearly full. */
    const spans = functionSpans(SOURCE);
    const span = spans.find((s) => s.name === 'seedIfEmpty_');
    assert.ok(span, 'seedIfEmpty_ is gone');
    const body = SOURCE.slice(span.start, span.end);
    assert.ok(/getLastRow\(\)\s*>=\s*2/.test(body),
      'seedIfEmpty_ lost its getLastRow guard');
    assert.ok(/isBlank\(\)/.test(body),
      'seedIfEmpty_ lost its isBlank guard');
  });
}

module.exports = { run };
