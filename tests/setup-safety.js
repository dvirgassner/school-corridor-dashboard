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

/* The only functions permitted to contain one. The first two are the
   script's own write helpers; the last two answer a click the principal
   just made in the אירועים tab, where clearing the conflicting box IS
   the requested behaviour. */
const MAY_WRITE = new Set([
  'writeHeader_', 'writeDayColumn_', 'seedIfEmpty_',
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

  test('no content-mutating call outside the four write helpers', () => {
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
