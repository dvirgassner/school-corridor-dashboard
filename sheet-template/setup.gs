/**
 * setup.gs — builds the corridor-board spreadsheet, and keeps it up to
 * date for the rest of its life.
 *
 * Creates five tabs (מערכת / מבחנים / אירועים / הודעות / הגדרות),
 * right-to-left, with headers, colours, notes, protections and data
 * validation that rejects anything the dashboard cannot display —
 * including per-field length limits derived from the pixel budget of
 * each element on the 1920x1080 board.
 *
 * IT NEVER ERASES WHAT SOMEONE TYPED. Every run applies the current
 * design and rules; example rows go only into a tab that is empty. This
 * is not a convention to be careful about — it is enforced. All content
 * writes go through writeHeader_(), writeDayColumn_() and seedIfEmpty_()
 * — the first two owning generated structure that is locked against
 * typing — and tests/run.js fails the build if a content-mutating call
 * appears anywhere else, or if running setup() against a mock sheet full
 * of data changes so much as one cell outside those columns.
 *
 * How to run: Extensions -> Apps Script, Run "setup", authorize when
 * asked. Deliberately NOT on the לוח מסדרון menu — the principal has no
 * reason to run it, and every reason not to wonder whether she should.
 */

/* Bump when this file changes. Run checkVersion() to see which copy the
   Apps Script project is actually executing — Apps Script merges every
   file in the project, so an old Code.gs left behind will quietly win
   over a newer paste. */
var SCRIPT_VERSION = '0.193';

/**
 * Report to whoever is watching, without ever throwing.
 *
 * SpreadsheetApp.getUi() is only available when a person is looking at
 * the spreadsheet. Called from a trigger, or from the Apps Script API
 * (clasp run), it throws "Cannot call SpreadsheetApp.getUi() from this
 * context" — which previously killed setup() on its very last line,
 * AFTER all the work had succeeded. A report is never worth failing for.
 */
function notify_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
    return;
  } catch (e) {}
  toast_(message);
}

/**
 * Non-blocking report. Use this for anything a script says on its way
 * out, and never getUi().alert().
 *
 * alert() waits for a click, and when the function was started from the
 * Apps Script editor that dialog opens in the SPREADSHEET tab — which
 * nobody is looking at. The editor just shows a spinner, for as long as
 * it takes someone to notice, which looks exactly like a hang. A
 * completion message must never be able to stall the run that produced
 * it.
 */
function toast_(message) {
  try {
    SpreadsheetApp.getActiveSpreadsheet()
      .toast(String(message).slice(0, 400), 'לוח מסדרון', 15);
  } catch (e) {}
  Logger.log(message);          /* always in the execution log too */
}

/** Run this to confirm which version of the script is loaded. */
function checkVersion() {
  notify_(
    'גרסת הסקריפט: ' + SCRIPT_VERSION + '\n\n' +
    'אם המספר אינו ' + SCRIPT_VERSION + ', קיים בפרויקט קובץ נוסף עם גרסה ישנה —\n' +
    'יש למחוק אותו ולהשאיר קובץ אחד בלבד.');
}

/* Grade columns. Change these if the school renames or splits grades —
   add a 7th and the dashboard adapts on its own (the 7th card takes the
   top-left cell and the agenda panel moves below it). Keep names <= 4
   characters so they fit the chips. */
var GRADES = ['ז׳', 'ח׳', 'ט׳', 'י׳', 'י"א', 'י"ב'];

var LIMITS = {
  scheduleSubject: 16,
  examSubject: 12,
  examRoom: 12,
  eventTitle: 22,
  eventLocation: 12,
  messageNormal: 90,
  /* Was 75, when the urgent strip truncated anything too wide for it and
     the cap was the only thing preventing a half-shown notice. The strip
     scrolls now, so the limit is about how long a passer-by will wait for
     the text to come round rather than about what fits. */
  messageUrgent: 90
};

/* The four tabs are published as public CSV feeds so the board can read
   them without logging in — which means anyone holding a feed URL can
   read their contents. This warning is attached to the sheet itself,
   where whoever is typing will actually see it. */
var NO_PII_NOTE =
  '⚠️ אין להזין בגיליון זה פרטים אישיים!\n\n' +
  'הגיליון מפורסם כדי שהמסך יוכל לקרוא אותו, ולכן תוכנו קריא לכל מי\n' +
  'שיש לו את הקישור — גם מחוץ לבית הספר.\n\n' +
  'אסור להזין: שמות תלמידים, מספרי זהות, ציונים, טלפונים או כל מידע\n' +
  'אישי אחר. מותר: מערכת שעות, מבחנים, אירועים והודעות כלליות.';

var DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];
var TYPES = ['רגילה', 'דחופה', 'וידאו'];
var YESNO = ['כן', 'לא'];
var THEMES = ['כהה', 'בהירה', 'צבעוני 1', 'צבעוני 2'];

/* the אירועים tab's fixed columns, before the per-grade checkboxes */
var EVENT_FIXED = ['תאריך', 'כותרת', 'התחלה', 'סיום', 'מקום'];

/* How many event rows to prepare. The list is meant to hold only what is
   still live, so five is plenty — and onEdit extends the checkboxes
   automatically the moment a sixth event is typed in. */
var EVENT_MIN_ROWS = 5;

/* tabs whose validation onEdit knows how to restore after a paste */
var TAB_RULES = ['מערכת', 'מבחנים', 'אירועים', 'הודעות', 'הגדרות'];

/* The link header spells out what belongs in it, because "קישור" alone
   invites any URL. The board matches this column by its leading word,
   so the parenthetical can be reworded freely. */
var MESSAGE_HEADERS = ['הודעה', 'סוג',
                       'קישור לוידאו (Google Drive או YouTube)', 'סאונד'];

/* Pale tints of the board's grade colours, so the timetable's columns
   read as the same six groups on screen and in the sheet. Backgrounds
   only — the sheet stays black text on light, which is what makes 60
   rows of it readable. */
var GRADE_TINTS  = ['#d9ead3', '#cfe2f3', '#fce5cd',
                    '#ead1dc', '#d9d2e9', '#d0e0e3', '#f4cccc'];
var GRADE_HEADER_TINTS = ['#b6d7a8', '#9fc5e8', '#f9cb9c',
                          '#d5a6bd', '#b4a7d6', '#a2c4c9', '#ea9999'];

/**
 * Say something about the locale only when it is worth saying — i.e.
 * when it is NOT Hebrew, and every date typed into the sheet is about to
 * be read in the wrong order.
 */
function localeNote_(locale) {
  if (/^(iw|he)/.test(locale || '')) return '';
  return '\n\n⚠️ שפת הגיליון היא "' + locale + '" ולא עברית.\n' +
         'המשמעות: 1/9/2026 ייקרא כ-9 בינואר ולא כ-1 בספטמבר.\n' +
         'יש לתקן ידנית: קובץ → הגדרות → אזור → ישראל.';
}

/**
 * Put the spreadsheet into a Hebrew locale, and report which code stuck.
 *
 * This is not cosmetic — it decides how a typed date is READ. In an
 * en_US locale "01/09/2026" is the 9th of January; in a Hebrew one it is
 * the 1st of September. Get it wrong and every date the principal enters
 * lands three seasons away from where she meant, with nothing on screen
 * to say so.
 *
 * Google Sheets wants "iw_IL" for Hebrew — the legacy ISO code, the same
 * quirk that makes Java call Hebrew "iw". "he_IL" is the modern spelling
 * and is quietly IGNORED: no error, no change, the sheet simply stays on
 * whatever locale it was created with. That is exactly the bug this
 * function exists to close, so it verifies rather than assumes.
 */
function setHebrewLocale_(ss) {
  ['iw_IL', 'iw', 'he_IL'].forEach(function (code) {
    if (/^(iw|he)/.test(ss.getSpreadsheetLocale() || '')) return;
    try { ss.setSpreadsheetLocale(code); } catch (e) {}
  });
  return ss.getSpreadsheetLocale();
}

/**
 * The five tabs, each split into the part that may write (seed) and the
 * part that never does (style). setup() walks this list.
 */
function tabs_() {
  return [
    { name: 'מערכת',   seed: seedSchedule_, style: styleSchedule_ },
    { name: 'מבחנים',  seed: seedExams_,    style: styleExams_ },
    { name: 'אירועים', seed: seedEvents_,   style: styleEvents_ },
    { name: 'הודעות',  seed: seedMessages_, style: styleMessages_ },
    { name: 'הגדרות',  seed: seedSettings_, style: styleSettings_ }
  ];
}

/** Re-apply one tab's dropdowns, checkboxes and limits. */
function applyRules_(sh, name) {
  if (name === 'מערכת')  return rulesSchedule_(sh);
  if (name === 'מבחנים') return rulesExams_(sh);
  if (name === 'אירועים') return rulesEvents_(sh);
  if (name === 'הודעות') return rulesMessages_(sh);
  if (name === 'הגדרות') return rulesSettings_(sh);
}

/**
 * Build the sheet, or bring an existing one up to date. Safe to run at
 * any point in the sheet's life, including on a live one mid-term.
 *
 * A tab that is empty gets its example rows. A tab that already holds the
 * school's real content gets styled and re-validated and NOTHING ELSE —
 * there is no path through this script that erases a populated tab, which
 * is why it no longer needs a warning or a confirmation step.
 *
 * Deliberately absent from the לוח מסדרון menu: harmless is not the same
 * as useful to the principal, and a run takes half a minute.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var locale = setHebrewLocale_(ss);
  ss.setSpreadsheetTimeZone('Asia/Jerusalem');

  /* Each tab under its own guard. Without this, one bad call aborts the
     run with a stack trace partway through, leaving the rest of the sheet
     on the old design with no report of how far it got. */
  var seeded = [], styled = [], failed = [];
  tabs_().forEach(function (tab) {
    try {
      var sh = ensureSheet_(ss, tab.name);
      var isNew = tab.seed(sh);
      tab.style(sh);
      applyRules_(sh, tab.name);
      (isNew ? seeded : styled).push(tab.name);
    } catch (err) {
      failed.push(tab.name + ': ' + err.message);
    }
  });

  if (failed.length) {
    toast_(
      'ההרצה הושלמה חלקית.\n\n' +
      'הצליחו: ' + seeded.concat(styled).join(', ') + '\n\n' +
      'נכשלו:\n' + failed.join('\n') + '\n\n' +
      'לא נמחק מידע. אפשר להריץ שוב לאחר תיקון, ' +
      'או לפנות לאחראי הטכני עם הטקסט הזה.');
    return;
  }

  if (!styled.length) {
    toast_(
      'הגיליון נבנה בהצלחה. (גרסת סקריפט ' + SCRIPT_VERSION + ')\n\n' +
      'השלב הבא: שיתוף → גישה כללית → "כל מי שיש לו הקישור" (מציג),\n' +
      'או פרסום באינטרנט של כל גיליון בנפרד כ-CSV.\n' +
      'ראו את ההוראות המלאות בקובץ README.\n\n' +
      '─────────────────────────\n' + NO_PII_NOTE + localeNote_(locale));
    return;
  }

  toast_(
    'העיצוב והחוקים עודכנו. (גרסת סקריפט ' + SCRIPT_VERSION + ')\n\n' +
    'עודכנו: ' + styled.join(', ') +
    (seeded.length ? '\nנבנו מחדש (היו ריקים): ' + seeded.join(', ') : '') +
    '\n\nהתוכן שהוזן בגיליון לא השתנה.' + localeNote_(locale));
}

/**
 * onEdit — runs automatically on every manual edit (a "simple trigger":
 * nothing to install, and it works for every editor of the sheet, not
 * just the owner).
 *
 * Two jobs in the אירועים tab: keep כולם mutually exclusive with the
 * grade boxes (the tick just made wins), and put validation back after a
 * paste. Without the first, an event could claim to be both "every
 * grade" and "just י׳", leaving the board to guess.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    var name = sh.getName();
    if (TAB_RULES.indexOf(name) < 0) return;
    if (e.range.getLastRow() < 2) return;          /* header row is locked */

    var pasted = e.range.getNumRows() > 1 || e.range.getNumColumns() > 1;

    /* A paste carries the SOURCE cell's formatting and data validation
       with it, which silently strips checkboxes and dropdowns from the
       destination. Rather than trying to forbid pasting, put the rules
       back afterwards — self-healing beats prohibition, and the office
       will paste no matter what the documentation says. */
    if (pasted) applyRules_(sh, name);

    if (name === 'אירועים') {
      ensureEventBoxes_(sh);        /* a new row gets its tick boxes */
      if (pasted) {
        /* a bulk edit has no single click to honour, so fall back to a
           fixed rule: כולם wins and the grade ticks clear */
        enforceExclusive_(sh, e.range);
      } else {
        resolveEventTick_(sh, e.range);
      }
    }
  } catch (err) {
    /* a trigger must never leave the sheet unusable — log and move on */
    console.error('onEdit: ' + err.message);
  }
}

/** Adds a "לוח מסדרון" menu, so a human can repair the sheet unaided. */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('לוח מסדרון')
      .addItem('תיקון חוקי הגיליון (תפריטים ותיבות סימון)', 'repairRules')
      .addItem('בדיקת תאים מוגנים', 'checkProtections')
      .addItem('גרסת הסקריפט', 'checkVersion')
      .addToUi();
  } catch (e) {}
  autoApply_();
}

/**
 * Apply rule changes by itself, so a new version of this script does not
 * need anyone to remember to press Run.
 *
 * Runs at most once per version: the version that was last applied is
 * remembered in the document's own properties. It only ever re-applies
 * validation — dropdowns, checkboxes, limits, conditional formatting —
 * which is non-destructive. It deliberately does NOT call setup(),
 * because setup() rebuilds tabs from scratch and would erase the
 * school's timetable. Structural changes stay a deliberate manual act.
 */
function autoApply_() {
  try {
    var props = PropertiesService.getDocumentProperties();
    if (props.getProperty('rulesVersion') === SCRIPT_VERSION) return;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var done = [];
    TAB_RULES.forEach(function (name) {
      var sh = ss.getSheetByName(name);
      if (!sh) return;
      applyRules_(sh, name);
      done.push(name);
    });
    var ev = ss.getSheetByName('אירועים');
    if (ev) enforceExclusive_(ev, null);

    props.setProperty('rulesVersion', SCRIPT_VERSION);
    if (done.length) {
      ss.toast('חוקי הגיליון עודכנו לגרסה ' + SCRIPT_VERSION,
               'לוח מסדרון', 5);
    }
  } catch (err) {
    /* A simple trigger runs without the user authorising anything, so
       some services can be unavailable. Never block opening the sheet. */
    console.error('autoApply_: ' + err.message);
  }
}

/**
 * List every protected range and who may edit it.
 *
 * Worth having because protection is easy to misjudge: Google never
 * restricts the spreadsheet's OWNER, so testing it from your own account
 * always looks like it failed. This reports what is actually configured,
 * without needing a second Google account to try it with.
 */
function checkProtections() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var me = Session.getEffectiveUser().getEmail();
  var lines = [];
  ss.getSheets().forEach(function (sh) {
    var ps = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    ps.forEach(function (p) {
      var who = p.getEditors().map(function (u) { return u.getEmail(); });
      lines.push('• ' + sh.getName() + ' · ' + p.getRange().getA1Notation() +
                 '\n   ' + (p.getDescription() || '(ללא תיאור)') +
                 '\n   ניתן לעריכה ל: ' + (who.join(', ') || '(איש)'));
    });
  });
  notify_(
    (lines.length ? lines.join('\n\n') : 'לא הוגדרו טווחים מוגנים.') +
    '\n\n──────────\n' +
    'הערה חשובה: בעל הגיליון (' + me + ') תמיד יכול לערוך הכול —\n' +
    'ההגנה חלה על מי שהגיליון שותף איתו כעורך, לא על הבעלים.\n' +
    'לבדיקה אמיתית יש לנסות מחשבון אחר.');
}

/** Re-apply every tab's validation. Safe to run at any time. */
function repairRules() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var done = [];
  TAB_RULES.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    applyRules_(sh, name);
    if (name === 'אירועים') enforceExclusive_(sh, null);
    done.push(name);
  });
  notify_('החוקים הוחזרו בגיליונות: ' + done.join(', '));
}

/**
 * The tick just made wins. Tick a grade while כולם is on and כולם
 * clears; tick כולם and the grades clear. Anything else would fight the
 * person doing the clicking: they said what they wanted last.
 */
function resolveEventTick_(sh, range) {
  if (range.getValue() !== true) return;      /* only a tick matters */
  var cols = eventColumns_(sh);
  if (!cols) return;
  var row = range.getRow(), col = range.getColumn();

  if (col === cols.allCol) {
    sh.getRange(row, cols.firstGrade, 1, cols.gradeCount).clearContent();
  } else if (col >= cols.firstGrade &&
             col < cols.firstGrade + cols.gradeCount) {
    sh.getRange(row, cols.allCol).clearContent();
  }
}

/**
 * כולם and the individual grades are mutually exclusive. Used for bulk
 * edits, where there is no single click to honour: כולם wins and the
 * grades clear. Pass a range to check only the rows it touches, or null
 * for every row.
 */
function enforceExclusive_(sh, range) {
  var cols = eventColumns_(sh);
  if (!cols) return;
  var from = range ? Math.max(2, range.getRow()) : 2;
  var to = range ? range.getLastRow() : sh.getLastRow();
  if (to < from) return;

  var grades = sh.getRange(from, cols.firstGrade, to - from + 1, cols.gradeCount);
  var all = sh.getRange(from, cols.allCol, to - from + 1);
  var gv = grades.getValues(), av = all.getValues();
  var touched = false;

  for (var r = 0; r < gv.length; r++) {
    if (av[r][0] !== true) continue;
    for (var c = 0; c < gv[r].length; c++) {
      if (gv[r][c] === true) { gv[r][c] = false; touched = true; }
    }
  }
  if (touched) grades.setValues(gv);
}

/** Locate the grade columns and the כולם column from the header row. */
function eventColumns_(sh) {
  var last = sh.getLastColumn();
  if (last < 2) return null;
  var headers = sh.getRange(1, 1, 1, last).getValues()[0];
  var allCol = 0;
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === 'כולם') { allCol = i + 1; break; }
  }
  if (!allCol) return null;
  var firstGrade = EVENT_FIXED.length + 1;
  if (allCol <= firstGrade) return null;
  return {
    allCol: allCol,
    firstGrade: firstGrade,
    gradeCount: allCol - firstGrade
  };
}

/* ---------- helpers ---------- */

/**
 * Get the tab, creating it only if it is genuinely absent, and make room
 * for the rules that follow. Nothing here removes cell CONTENT.
 *
 * The stale data validation IS cleared: dropdowns and checkboxes are
 * properties of a cell alongside its value, not the value itself, and
 * wiping them first is what stops an old layout's rules from surviving
 * under a new one. A tick stays a tick; only the box around it is redrawn.
 */
function ensureSheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearConditionalFormatRules();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  try { sh.setRightToLeft(true); } catch (e) {}
  /* A sheet converted from an uploaded CSV arrives sized to its data
     (sometimes 2x2). Any later setDataValidation() over a taller range
     would throw "out of bounds" and abort the whole script, so make
     room up front. Inserting rows past the end adds blank ones; it never
     displaces anything already typed. */
  if (sh.getMaxRows() < 100) {
    sh.insertRowsAfter(sh.getMaxRows(), 100 - sh.getMaxRows());
  }
  if (sh.getMaxColumns() < 12) {
    sh.insertColumnsAfter(sh.getMaxColumns(), 12 - sh.getMaxColumns());
  }
  return sh;
}

/* ---------- the only two functions here that write cell contents -------
   Everything else in this file formats, validates, protects or annotates.
   Those operations reach the data rows freely — a background colour or a
   dropdown is stored beside a cell's value, not in place of it — which is
   how a design change can be applied to a sheet full of real timetable
   without disturbing a single subject name.

   tests/run.js enforces this mechanically: it walks the whole file and
   fails if any content-mutating call appears outside the four functions
   allowed to make one (these two, plus the two that answer a click in
   the אירועים tab). Keep it that way. */

/**
 * Own the יום column: one merged cell per day, carrying the day letter
 * once, large and centred in its block.
 *
 * This writes cell contents, which is why it lives here with the other
 * write helpers rather than in styleSchedule_. It is not the principal's
 * content though — column A is generated, locked, and cannot be typed
 * into, exactly like the header row. What it must never touch is a
 * subject name, and it only ever addresses column A.
 *
 * Idempotent: unmerge, write, re-merge, every run. On a sheet already in
 * this shape the values written are identical to the ones already there,
 * so a re-run changes nothing. Order matters — Sheets refuses to set
 * values across merged cells, so the block has to come apart first.
 *
 * The board reads this column to group rows by day, and a merged cell
 * exports to CSV as its value on the first row and BLANKS below. That is
 * handled in buildSchedule(), which treats a blank day as "same as
 * above". The two must change together.
 */
function writeDayColumn_(sh) {
  var per = PERIODS.length;
  var col = sh.getRange(2, 1, DAYS.length * per, 1);

  try { col.breakApart(); } catch (e) {}   /* no-op when nothing is merged */

  var vals = [];
  DAYS.forEach(function (d) {
    for (var i = 0; i < per; i++) vals.push([i === 0 ? d : '']);
  });
  col.setValues(vals);

  DAYS.forEach(function (d, di) {
    sh.getRange(2 + di * per, 1, per, 1).merge();
  });

  col.setFontSize(30)
     .setFontColor('#000000')
     .setFontWeight('bold')
     .setHorizontalAlignment('center')
     .setVerticalAlignment('middle');
}

/**
 * Write the header row — and only when it actually differs, so a re-run
 * on a live sheet is a no-op rather than a rewrite.
 */
function writeHeader_(sh, headers) {
  var row = sh.getRange(1, 1, 1, headers.length);
  var current = row.getValues()[0];
  var same = true;
  for (var i = 0; i < headers.length; i++) {
    if (String(current[i]) !== String(headers[i])) { same = false; break; }
  }
  if (!same) row.setValues([headers]);

  row.setFontWeight('bold').setBackground('#efefef');
  sh.setFrozenRows(1);
  /* Headers are structural: the board finds its columns by these names,
     so a well-meaning rename silently empties a panel. Genuinely locked,
     not merely warned about. */
  lock_(sh.getRange(1, 1, 1, sh.getMaxColumns()), 'כותרות — לא לשינוי');
}

/**
 * Put the example rows in, but ONLY into a tab that has nothing below its
 * header. This is what makes setup() safe to re-run for the rest of the
 * sheet's life: once the school's real timetable is in, every later run
 * restyles and re-validates and seeds nothing.
 *
 * Two independent checks, because this is the one call that could destroy
 * a term's work: getLastRow() says where content ends, and isBlank()
 * confirms the specific target rows really are empty. Either one saying
 * "occupied" is enough to skip.
 */
function seedIfEmpty_(sh, rows) {
  if (!rows || !rows.length) return false;
  if (sh.getLastRow() >= 2) return false;
  var rng = sh.getRange(2, 1, rows.length, rows[0].length);
  if (!rng.isBlank()) return false;
  rng.setValues(rows);
  return true;
}

/**
 * Lock a range so only the script's owner can edit it. Everyone else the
 * sheet is shared with (the principal, the office) keeps full access to
 * everything NOT locked.
 *
 * Re-running setup() would otherwise stack duplicate protections, so any
 * existing protection with the same description is removed first.
 */
function lock_(range, description) {
  var sh = range.getSheet();
  var existing = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  existing.forEach(function (p) {
    if (p.getDescription() === description) p.remove();
  });

  var p = range.protect().setDescription(description);
  var me = Session.getEffectiveUser();
  p.addEditor(me);
  /* strip everyone else; ignore failures on domain-managed sheets */
  try {
    var others = p.getEditors().filter(function (u) {
      return u.getEmail() && u.getEmail() !== me.getEmail();
    });
    if (others.length) p.removeEditors(others);
  } catch (e) {}
  try {
    if (p.canDomainEdit()) p.setDomainEdit(false);
  } catch (e) {}
}

/**
 * Effective length, counting any emoji as exactly two characters.
 *
 * LEN() counts UTF-16 units, so 🎉 is 2 but 👨‍👩‍👧 is 11 and 🏃‍♀️ is 5 —
 * a composite emoji would eat most of a 16-character subject name for no
 * corresponding width on screen. Two is right both as a cap and as a
 * width estimate: an emoji renders about as wide as two Hebrew letters.
 *
 * The regex matches one emoji CLUSTER: a flag pair, or a base emoji with
 * its modifiers and any ZWJ-joined continuation. Each is rewritten to
 * "xx" before measuring. Verified against real strings before shipping,
 * because a wrong rule here rejects text the principal legitimately
 * typed.
 *
 * IFERROR is the safety net: if this build of Sheets rejects the pattern,
 * the rule silently falls back to plain LEN — today's behaviour — rather
 * than failing shut and refusing every edit.
 */
var EMOJI_BASE = '[\\x{1F000}-\\x{1FAFF}\\x{2600}-\\x{27BF}' +
                 '\\x{2B00}-\\x{2BFF}\\x{2190}-\\x{21FF}]';
var EMOJI_TAIL = '[\\x{FE0F}\\x{1F3FB}-\\x{1F3FF}\\x{20E3}]';
var EMOJI_RI   = '[\\x{1F1E6}-\\x{1F1FF}]';
var EMOJI_CLUSTER =
  '(?:' + EMOJI_RI + EMOJI_RI + '|' +
  EMOJI_BASE + EMOJI_TAIL + '*(?:\\x{200D}' + EMOJI_BASE + EMOJI_TAIL + '*)*)';

function effLen_(cell) {
  return 'IFERROR(LEN(REGEXREPLACE(TO_TEXT(' + cell + '), "' +
         EMOJI_CLUSTER + '", "xx")), LEN(' + cell + '))';
}

/**
 * How far down a validation or conditional-format rule should reach.
 *
 * The rows that exist plus room to grow, rather than a flat 500: the
 * length formula runs a regex per cell, and covering six grade columns ×
 * 500 rows made setup crawl for no benefit — nobody types below the
 * block. The sheet's own height is the last clamp, so the range can
 * never be asked to extend past the final row.
 */
function ruleRows_(sh) {
  return Math.min(sh.getMaxRows() - 1, Math.max(50, sh.getLastRow() + 20));
}

/** Text-length rule with a Hebrew rejection message. */
function lenRule_(sh, col, max, label) {
  var rows = ruleRows_(sh);
  var rng = sh.getRange(2, col, rows);
  var rule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=' + effLen_('INDIRECT("RC", FALSE)') + '<=' + max)
    .setAllowInvalid(false)
    .setHelpText(label + ': עד ' + max + ' תווים (מגבלת רוחב במסך). ' +
                 'אמוג\'י נחשב כשני תווים.')
    .build();
  rng.setDataValidation(rule);
}

/** Dropdown list rule. */
function listRule_(sh, col, values, label) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .setHelpText(label + ': ' + values.join(' / '))
    .build();
  sh.getRange(2, col, 500).setDataValidation(rule);
}

/** HH:MM time rule (kept as text so no timezone surprises). */
function timeRule_(sh, col) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=REGEXMATCH(TO_TEXT(INDIRECT("RC", FALSE)), "^\\d{1,2}:\\d{2}$")')
    .setAllowInvalid(false)
    .setHelpText('שעה בפורמט HH:MM, למשל 08:50')
    .build();
  sh.getRange(2, col, 500).setDataValidation(rule);
  sh.getRange(2, col, 500).setNumberFormat('@');   /* plain text */
}

/**
 * Date rule. Rejects more than "is this a date", because the typing
 * errors that actually cost something all produce PERFECTLY VALID dates:
 *
 *   • a mistyped year (2072 instead of 2027) — the exam never appears
 *   • last year's date on a repeated exam — same
 *   • a date already past — the row is silently skipped
 *
 * None of those look wrong in the cell, and the board cannot report
 * them: an exam that never shows produces no error anywhere. So the
 * window is bounded, from a month back to a year ahead.
 */
function dateRule_(sh, col) {
  var n = ruleRows_(sh);
  var cell = 'INDIRECT("RC", FALSE)';
  var rule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(
      '=AND(ISDATE(' + cell + '), ' + cell + '>=TODAY()-60, ' +
      cell + '<=TODAY()+500)')
    /* WARN, never refuse. setAllowInvalid(false) made this rule the thing
       standing between the principal and her own sheet: a date Sheets
       would have parsed perfectly well was rejected outright, with a
       message naming the very format she had just typed. A date that
       looks wrong is worth a flag; it is never worth refusing to record.
       The colour flags below do the actual telling. */
    .setAllowInvalid(true)
    .setHelpText('אפשר להזין תאריך בכל צורה מקובלת: 1/9/2026 או 01.09.2026 ' +
                 'או 1 בספטמבר 2026 — הגיליון ימיר לתבנית אחידה.\n\n' +
                 'תאריך שנראה חריג (רחוק מדי אחורה או קדימה) יסומן בצבע ' +
                 'כאזהרה, אבל לא ייחסם.')
    .build();
  sh.getRange(2, col, n).setDataValidation(rule)
    /* One display format for everything the locale accepts — the Israeli
       convention, and still self-checking: under a wrong locale, typing
       1/9/2026 comes back as 09/01/2026, and the swapped day and month
       are visible at a glance. */
    .setNumberFormat('dd/mm/yyyy');
}

/**
 * Two visual warnings on the date column, for the mistakes validation
 * cannot catch because nothing was typed at all, or because the value
 * was legal when entered and has since gone stale.
 *
 *   red   — the row has content but NO date: it will never be shown,
 *           and this is the single most confusing failure in the sheet
 *   grey  — the date has passed: the row is inert, not broken
 */
function dateFlags_(sh, dateCol, contentCol) {
  var n = ruleRows_(sh);
  var d = '$' + colLetter_(dateCol) + '2';
  var c = '$' + colLetter_(contentCol) + '2';
  var range = sh.getRange(2, dateCol, n);

  /* Order matters: Sheets applies the FIRST rule that matches, so the
     loudest problems have to come first. */

  /* something is in the cell but Sheets could not read it as a date —
     usually a typo, or text where a date belongs */
  var notdate = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + d + '<>"", NOT(ISDATE(' + d + ')))')
    .setBackground('#f4c7c3')
    .setFontColor('#a50e0e')
    .setRanges([range])
    .build();
  /* the row has content but no date at all — it will never be shown */
  var missing = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + c + '<>"", ' + d + '="")')
    .setBackground('#f4c7c3')
    .setRanges([range])
    .build();
  /* a real date, but implausibly far away — this is what catches the
     mistyped year, now that the rule warns instead of refusing */
  var far = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(
      '=AND(ISDATE(' + d + '), OR(' + d + '<TODAY()-60, ' +
      d + '>TODAY()+500))')
    .setBackground('#fce8b2')
    .setFontColor('#7f6000')
    .setRanges([range])
    .build();
  var past = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(ISDATE(' + d + '), ' + d + '<TODAY())')
    .setBackground('#efefef')
    .setFontColor('#9e9e9e')
    .setRanges([range])
    .build();

  /* Drop this column's previous flags before re-adding them, or every
     re-run of setup stacks another identical pair. Matching on the RANGE
     rather than on the formula text is what makes that reliable: the two
     formulas differ from each other, while "a single-column rule sitting
     on the date column" describes both and describes nothing else in
     these tabs (the כולם rules live on the checkbox columns). */
  var rules = sh.getConditionalFormatRules().filter(function (r) {
    var g = r.getRanges();
    return !g.length || !g.every(function (x) {
      return x.getColumn() === dateCol && x.getNumColumns() === 1;
    });
  });
  rules.push(notdate, missing, far, past);
  sh.setConditionalFormatRules(rules);
  sh.getRange(1, dateCol).setNote(
    'התאריך קובע באיזה יום הפריט יופיע על הלוח — הוא עצמו לא מוצג.\n\n' +
    'אפשר להזין בכל צורה מקובלת: 1/9/2026, 01.09.2026, 1 בספטמבר 2026.\n' +
    'הגיליון ממיר לתבנית אחידה (01/09/2026). שום תאריך לא נחסם.\n\n' +
    '• תא אדום = חסר תאריך, או שמה שהוזן אינו תאריך. הפריט לא יופיע.\n' +
    '• תא כתום = תאריך רחוק מדי. בדקו את השנה — כנראה טעות הקלדה.\n' +
    '• תא אפור = התאריך עבר. הפריט כבר לא מוצג; אפשר למחוק את השורה.');
}

/* ---------- validation rules, separated so they can be restored ----------
   Everything here is NATIVE Google Sheets validation, which lives in the
   document itself. It survives the Apps Script project being deleted; only
   the automatic re-application after a paste needs the script. */

function rulesSchedule_(sh) {
  /* No dropdown on the day column: every row is pre-filled with its day
     and period, so there is nothing to choose. The column is locked
     instead (see styleSchedule_). */
  timeRule_(sh, 3);
  timeRule_(sh, 4);
  var last = Math.max(5, sh.getLastColumn());
  for (var c = 5; c <= last; c++) {
    lenRule_(sh, c, LIMITS.scheduleSubject, 'שם מקצוע');
  }
}

function rulesMessages_(sh) {
  /* length depends on the type: urgent text is displayed larger */
  var textRule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(
      '=' + effLen_('INDIRECT("RC", FALSE)') +
      '<=IF(INDIRECT("RC[1]", FALSE)="דחופה",' +
      LIMITS.messageUrgent + ',' + LIMITS.messageNormal + ')')
    .setAllowInvalid(false)
    .setHelpText('הודעה רגילה: עד ' + LIMITS.messageNormal + ' תווים. ' +
                 'הודעה דחופה: עד ' + LIMITS.messageUrgent + ' תווים. ' +
                 'אמוג\'י נחשב כשני תווים.')
    .build();
  var msgRows = ruleRows_(sh);
  sh.getRange(2, 1, msgRows).setDataValidation(textRule);

  listRule_(sh, 2, TYPES, 'סוג');
  listRule_(sh, 4, YESNO, 'סאונד');   /* audio on/off, only read for וידאו */

  /* Grey out סאונד on rows that are not videos, so it is visibly
     inapplicable rather than merely ignored. */
  var marker = '$B2="וידאו"';
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($A2<>"", NOT(' + marker + '))')
    .setBackground('#efefef')
    .setFontColor('#b7b7b7')
    .setRanges([sh.getRange(2, 4, 500)])
    .build();
  var rules = sh.getConditionalFormatRules().filter(function (r) {
    var c = r.getBooleanCondition();
    return !c || String(c.getCriteriaValues()).indexOf(marker) < 0;
  });
  rules.push(rule);
  sh.setConditionalFormatRules(rules);
}

function rulesSettings_(sh) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(THEMES, true)
    .setAllowInvalid(false)
    .setHelpText('ערכת נושא: ' + THEMES.join(' / '))
    .build();
  sh.getRange(2, 2, Math.max(2, sh.getMaxRows() - 1)).setDataValidation(rule);

  /* verify rather than assume: a missing dropdown here is invisible
     until someone tries to change the theme on a live board */
  if (!sh.getRange('B2').getDataValidation()) {
    throw new Error('התפריט הנפתח של ערכת הנושא לא נוצר — ' +
                    'יש לבחור בתפריט "לוח מסדרון" → "תיקון חוקי הגיליון"');
  }
}

function rulesExams_(sh) {
  dateRule_(sh, 1);
  dateFlags_(sh, 1, 3);          /* flag a subject with no date */
  listRule_(sh, 2, GRADES, 'שכבה');
  lenRule_(sh, 3, LIMITS.examSubject, 'מקצוע');
  timeRule_(sh, 4);
  timeRule_(sh, 5);
  lenRule_(sh, 6, LIMITS.examRoom, 'מקום');
}

function rulesEvents_(sh) {
  dateRule_(sh, 1);
  dateFlags_(sh, 1, 2);          /* flag a title with no date */
  lenRule_(sh, 2, LIMITS.eventTitle, 'כותרת');
  timeRule_(sh, 3);
  timeRule_(sh, 4);
  lenRule_(sh, 5, LIMITS.eventLocation, 'מקום');

  var tickCount = GRADES.length + 1;
  var firstGradeCol = EVENT_FIXED.length + 1;
  ensureEventBoxes_(sh);

  /* Conditional formatting is evaluated by the browser, so it reacts the
     INSTANT a box is ticked — unlike onEdit, which is a server-side
     trigger and lands a moment later. Painting exactly the redundant
     grade boxes red gives immediate feedback about what is about to be
     cleared, and it keeps working even with no script in the project. */
  var lastCol = firstGradeCol + tickCount - 1;
  var a1All = colLetter_(lastCol);
  var a1First = colLetter_(firstGradeCol);
  var a1LastGrade = colLetter_(lastCol - 1);
  var marker = '$' + a1All + '2=TRUE';
  var conflict = 'AND(' + marker + ', COUNTIF($' + a1First + '2:$' +
                 a1LastGrade + '2, TRUE)>0)';

  /* Two rules, so whichever box is about to be cleared is the one that
     turns red: tick a grade and כולם goes red (it is what clears); tick
     כולם and the grade boxes go red. */
  var onAll = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=' + conflict)
    .setBackground('#f4c7c3')
    .setRanges([sh.getRange(2, lastCol, 200)])
    .build();
  var onGrades = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + conflict + ', ' + a1First + '2=TRUE)')
    .setBackground('#f4c7c3')
    .setRanges([sh.getRange(2, firstGradeCol, 200, tickCount - 1)])
    .build();

  var rules = sh.getConditionalFormatRules().filter(function (r) {
    /* drop our previous copies so re-running does not stack rules */
    var c = r.getBooleanCondition();
    return !c || String(c.getCriteriaValues()).indexOf(marker) < 0;
  });
  rules.push(onAll, onGrades);
  sh.setConditionalFormatRules(rules);

  if (!sh.getRange(2, firstGradeCol).getDataValidation()) {
    throw new Error('לא נוצרו תיבות סימון בגיליון "אירועים".');
  }
}

/**
 * Give every event row its grade checkboxes, growing the range as rows
 * are added — five to start with, and always one spare below whatever
 * has been typed, so there is a ready row for the next event.
 *
 * Uses checkbox DATA VALIDATION rather than Range.insertCheckboxes().
 * That distinction matters: insertCheckboxes() sets every cell in the
 * range to false, so calling it from the paste-repair path would have
 * silently cleared the grade ticks on every existing event. Validation
 * alone gives the same tick boxes and never touches a value.
 *
 * A further benefit: cells left untouched stay genuinely EMPTY instead
 * of holding FALSE, so the published CSV the board fetches every minute
 * carries no filler rows.
 */
function ensureEventBoxes_(sh) {
  var cols = eventColumns_(sh);
  if (!cols) return;
  var want = Math.max(1 + EVENT_MIN_ROWS, lastEventRow_(sh) + 1);
  if (want > sh.getMaxRows()) {
    sh.insertRowsAfter(sh.getMaxRows(), want - sh.getMaxRows());
  }
  var rng = sh.getRange(2, cols.firstGrade, want - 1, cols.gradeCount + 1);
  rng.setDataValidation(
    SpreadsheetApp.newDataValidation().requireCheckbox().build());
  rng.setHorizontalAlignment('center');

  /* Take the boxes off any row below that. Without this the tab only ever
     grows, and every stale row still exports as FALSE into the CSV the
     board fetches every minute. */
  var below = sh.getMaxRows() - want;
  if (below > 0) {
    sh.getRange(want + 1, cols.firstGrade, below, cols.gradeCount + 1)
      .clearDataValidations();
  }
}

/**
 * The last row holding an actual event, judged by its date or title —
 * never by its checkboxes.
 *
 * This distinction is the whole fix for a nasty little bug: ticking a box
 * gives that row content, so a rule based on getLastRow() treated the
 * spare row as used and added another spare beneath it. Every tick grew
 * the sheet by a row, each one exporting as FALSE into the board's feed.
 */
function lastEventRow_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 1;
  var vals = sh.getRange(2, 1, last - 1, 2).getValues();   /* date, title */
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]).trim() !== '' || String(vals[i][1]).trim() !== '') {
      return i + 2;
    }
  }
  return 1;
}

/** 1 -> A, 27 -> AA */
function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = (n - m - 1) / 26;
  }
  return s;
}

/* ---------- the timetable's fixed shape ----------
   Ten period rows for every day, always. The principal fills in the
   subjects and leaves the rest empty — an empty cell simply means no
   class, so the day ends after the last subject entered. Nothing to add
   or delete, and no day to pick from a dropdown.

   styleSchedule_ needs this geometry as much as seedSchedule_ does: the
   thick day boxes are drawn from it, on a sheet whose contents it never
   reads. */
var PERIODS = [
  [1, '08:00', '08:45'], [2, '08:50', '09:35'], [3, '09:50', '10:35'],
  [4, '10:40', '11:25'], [5, '11:45', '12:30'], [6, '12:35', '13:20'],
  [7, '13:30', '14:15'], [8, '14:20', '15:05'], [9, '15:15', '16:00'],
  [10, '16:05', '16:50']
];

function scheduleHeaders_() {
  return ['יום', 'שיעור', 'התחלה', 'סיום'].concat(GRADES);
}

/* ---------- seeds: example content for an EMPTY tab only ---------- */

function seedSchedule_(sh) {
  var SUBJECTS = ['מתמטיקה', 'אנגלית', 'לשון', 'היסטוריה', 'ביולוגיה',
                  'פיזיקה', 'כימיה', 'ספרות', 'תנ"ך', 'אזרחות',
                  'חינוך גופני', 'מחשבים'];
  var rows = [];
  DAYS.forEach(function (day, di) {
    /* every day gets all ten rows; only some are filled with a subject */
    var filled = day === 'ו' ? 4 : (di % 2 === 0 ? 8 : 6);
    for (var p = 0; p < PERIODS.length; p++) {
      var row = [day].concat(PERIODS[p]);
      GRADES.forEach(function (g, gi) {
        /* upper grades keep going later than the lower ones */
        var has = p < filled && !(p >= 6 && gi < 2);
        row.push(has ? SUBJECTS[(di * 5 + p * 3 + gi * 7) % SUBJECTS.length] : '');
      });
      rows.push(row);
    }
  });
  return seedIfEmpty_(sh, rows);
}

function seedExams_(sh) {
  /* dated today so they appear on the board straight away */
  var today = new Date();
  return seedIfEmpty_(sh, [
    [today, GRADES[2], 'מתמטיקה', '09:00', '10:30', 'חדר 12'],
    [today, GRADES[5], 'אנגלית', '11:45', '12:30', 'ספרייה'],
    [today, GRADES[1], 'ביולוגיה', '12:35', '13:20', 'מעבדה']
  ]);
}

function seedEvents_(sh) {
  var today = new Date();
  var first = [today, 'חזרה כללית לטקס', '10:40', '11:25', 'אולם ספורט'];
  var second = [today, 'הרצאה: בטיחות ברשת', '12:35', '13:20', 'אודיטוריום'];
  var third = [today, 'עצרת פתיחת שנה', '08:00', '08:45', 'רחבת בית הספר'];
  /* '' rather than false for an unticked box: the cell still shows an
     empty checkbox, but stays out of the published CSV entirely */
  GRADES.forEach(function (g, gi) {
    first.push(gi < 2 ? true : '');     /* ז׳, ח׳    */
    second.push(gi >= 3 ? true : '');   /* י׳ ומעלה  */
    third.push('');                     /* כולם instead */
  });
  first.push('');
  second.push('');
  third.push(true);                     /* the כולם box */
  return seedIfEmpty_(sh, [first, second, third]);
}

function seedMessages_(sh) {
  return seedIfEmpty_(sh, [
    ['אסיפת הורים ביום שלישי בשעה 19:00', 'רגילה', '', ''],
    ['מחר: יום כחול-לבן — באים בלבוש חגיגי', 'רגילה', '', ''],
    ['שיעורי שכבת ז׳ מסתיימים היום ב-13:20', 'דחופה', '', ''],
    ['ההסעה לקו הדרומי יוצאת ב-14:00 מהשער האחורי', 'דחופה', '', '']
  ]);
}

function seedSettings_(sh) {
  return seedIfEmpty_(sh, [['ערכת נושא', 'כהה']]);
}

/* ---------- styles: applied to every tab, every run ----------
   These reach the data rows on purpose — that is where the grade tints,
   the day boxes and the locked columns belong. What they never do is
   read or replace what is typed in those rows. */

function styleSchedule_(sh) {
  var headers = scheduleHeaders_();
  writeHeader_(sh, headers);
  var rows = DAYS.length * PERIODS.length;

  /* Day and period are structural: the board groups rows by them, and a
     stray edit here silently moves classes to another day. Times stay
     editable — bell schedules genuinely differ between schools. */
  lock_(sh.getRange(2, 1, rows, 2), 'יום ומספר שיעור — לא לשינוי');
  /* Protection stops other editors but never the owner, so locked cells
     also LOOK locked. The grey BACKGROUND carries that signal on its own,
     like a form field you cannot type in; the text stays black, because
     these two columns are the ones you actually read while finding the
     right row, and dimming them made the sheet harder to use for no gain
     in clarity about what is editable. */
  sh.getRange(2, 1, rows, 2)
    .setHorizontalAlignment('center')
    .setBackground('#f0f0f0')
    .setFontColor('#000000');
  /* after the block styling above, so the day letter's own size wins */
  writeDayColumn_(sh);
  /* a faint band per day, so 60 rows stay readable */
  sh.getRange(2, 1, rows, headers.length).setBorder(
    null, null, null, null, null, true, '#d9d9d9',
    SpreadsheetApp.BorderStyle.SOLID);

  /* One colour per grade column, matching that grade's card on the
     board. Sixty rows of undifferentiated grid is hard to read; the
     colour makes the six groups obvious at a glance, and means a
     subject typed into the wrong grade stands out. */
  GRADES.forEach(function (g, gi) {
    var col = 5 + gi;
    sh.getRange(1, col).setBackground(GRADE_HEADER_TINTS[gi % GRADE_HEADER_TINTS.length]);
    sh.getRange(2, col, rows)
      .setBackground(GRADE_TINTS[gi % GRADE_TINTS.length]);
  });

  /* A thick box around each day's ten rows. Sixty rows of timetable is
     one undifferentiated block otherwise, and the day column alone is
     easy to lose track of when scrolling. */
  DAYS.forEach(function (day, di) {
    sh.getRange(2 + di * PERIODS.length, 1, PERIODS.length, headers.length)
      .setBorder(true, true, true, true, null, null,
                 '#555555', SpreadsheetApp.BorderStyle.SOLID_THICK);
  });

  sh.setColumnWidth(1, 60);
  sh.setColumnWidth(2, 70);
  sh.setColumnWidths(3, 2, 80);
  sh.setColumnWidths(5, GRADES.length, 130);
  sh.getRange('A1').setNote(
    'עשר שורות לכל יום, מוכנות מראש.\n\n' +
    'ממלאים רק את שמות המקצועות בעמודות השכבות.\n' +
    'תא ריק = אין שיעור. יום הלימודים מסתיים אחרי המקצוע האחרון\n' +
    'שהוזן, וכל מה שאחריו לא יוצג על הלוח.\n\n' +
    'עמודות "יום" ו"שיעור" נעולות — אין צורך לשנות אותן.\n' +
    'כל עמודה אחרי "סיום" היא שכבה — הלוח מתאים את עצמו אוטומטית.');
}

function styleExams_(sh) {
  var headers = ['תאריך', 'שכבה', 'מקצוע', 'התחלה', 'סיום', 'חדר'];
  writeHeader_(sh, headers);
  sh.setColumnWidths(1, headers.length, 110);
  sh.getRange('C1').setNote(
    'להזין את שם המקצוע בלבד — הלוח מוסיף מעצמו "מבחן ב".');
  sh.getRange('B1').setNote(NO_PII_NOTE);
}

/* An event can apply to several grades. Google Sheets cannot multi-select
   inside one cell, so each grade gets its own checkbox column — tick as
   many as apply, and the board shows whichever are ticked. */
function styleEvents_(sh) {
  var FIXED = EVENT_FIXED;
  /* ...GRADES, then a כולם box for a whole-school activity, so nobody has
     to tick every grade one at a time. onEdit() keeps כולם and the
     individual grades mutually exclusive. */
  var TICKS = GRADES.concat(['כולם']);
  writeHeader_(sh, FIXED.concat(TICKS));

  var firstGradeCol = FIXED.length + 1;
  sh.setColumnWidths(1, FIXED.length, 130);
  sh.setColumnWidths(firstGradeCol, TICKS.length, 60);
  sh.getRange(1, firstGradeCol, 1, GRADES.length).setNote(
    'לסמן ✓ בכל שכבה שהאירוע מיועד לה.\n' +
    'מארבע שכבות ומעלה הלוח מציג "כולם".');
  sh.getRange(1, firstGradeCol + GRADES.length).setNote(
    'אירוע לכל בית הספר — לסמן ✓ כאן במקום לסמן כל שכבה בנפרד.\n' +
    'הלוח יציג "כולם".');
}

function styleMessages_(sh) {
  writeHeader_(sh, MESSAGE_HEADERS);
  sh.setColumnWidth(1, 460);
  sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 320);
  sh.setColumnWidth(4, 80);
  sh.getRange('C1').setNote(
    'רק לסוג "וידאו".\n\n' +
    'מותר להדביק כאן:\n' +
    '  • קישור יוטיוב (מהדפדפן — watch, youtu.be או Shorts)\n' +
    '  • קישור שיתוף של קובץ וידאו בגוגל דרייב\n\n' +
    'חשוב: קובץ בדרייב חייב להיות משותף ל"כל מי שיש לו הקישור".\n' +
    'קישור לתיקייה או לדף אינטרנט לא יעבוד.');
  sh.getRange('D1').setNote(
    'רלוונטי רק לשורות מסוג "וידאו".\n' +
    'ריק או "לא" = סרטון מושתק (ברירת המחדל, כדי לא להפריע במסדרון).\n' +
    '"כן" = עם סאונד.\n\n' +
    'בהודעות רגילות ודחופות הערך נעלם מעצמו ואינו משפיע על כלום.');
  sh.getRange('A1').setNote(
    'הרשימה מציגה את מה שרלוונטי עכשיו — מוסיפים שורה כשצריך\n' +
    'ומוחקים אותה כשההודעה כבר לא רלוונטית.\n\n' + NO_PII_NOTE);
}

/* Presentation settings the principal can change without touching code.
   A plain key/value tab, so more settings can be added later without
   changing its shape. */
function styleSettings_(sh) {
  writeHeader_(sh, ['הגדרה', 'ערך']);

  /* The setting NAMES are structural — the board matches on them. Lock
     the whole column so only the value column is editable. */
  lock_(sh.getRange(2, 1, sh.getMaxRows() - 1), 'שמות הגדרות — לא לשינוי');
  sh.getRange(2, 1, sh.getMaxRows() - 1)
    .setBackground('#f0f0f0')
    .setFontColor('#7f7f7f');

  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(2, 160);
  sh.getRange('B1').setNote(
    'ערכת נושא של הלוח — בחירה מהתפריט והלוח מתחלף בתוך דקה:\n' +
    '  כהה — רקע שחור (ברירת המחדל; הידידותית ביותר למסך OLED)\n' +
    '  בהירה — רקע לבן, למסדרון מואר\n' +
    '  צבעוני 1 — רקע כהה וכרטיסים צבעוניים בולטים\n  צבעוני 2 — רקע בהיר וגוון עדין לכל שכבה\n\n' +
    'המבנה, הגדלים והגופנים זהים בכל הערכות — רק הצבעים מתחלפים.');
}
