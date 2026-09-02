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
var SCRIPT_VERSION = '0.202';

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

/* Every grade owns TWO columns in the מערכת tab: the subject, and the
   room it is taught in. The room column's header is the grade's own
   label plus this suffix — one convention, derivable in both
   directions, so the board can find a grade's room column from its
   subject column without a second lookup table to keep in step. */
var ROOM_SUFFIX = ' חדר';
function roomHeader_(grade) { return grade + ROOM_SUFFIX; }

/** Is this header a room column rather than a subject column? */
function isRoomHeader_(h) {
  h = String(h == null ? '' : h).trim();
  if (!h) return false;
  if (h === 'חדר') return true;                 /* a hand-headed sheet */
  return h.length > ROOM_SUFFIX.length &&
         h.slice(h.length - ROOM_SUFFIX.length) === ROOM_SUFFIX;
}

/* Columns before the first grade: יום, שיעור, התחלה, סיום. */
var SCHEDULE_FIXED_COLS = 4;

/** 1-based column of grade gi's SUBJECT; its room is the next column. */
function gradeColumn_(gi) { return SCHEDULE_FIXED_COLS + 1 + gi * 2; }

/* The description lock_ uses for the מערכת tab's script-written columns,
   and the descriptions earlier versions used over the same cells. lock_
   removes those too, so a sheet that has lived through both does not end
   up carrying two protections over one range — which is invisible until
   someone tries to work out who may edit what. */
var SCHEDULE_LOCK = 'יום, שיעור ושעות — לא לשינוי';
var LEGACY_LOCKS = {};
LEGACY_LOCKS[SCHEDULE_LOCK] = ['יום ומספר שיעור — לא לשינוי'];

var LIMITS = {
  /* Sixteen rejected the real timetable outright: the longest subject
     name in use, "תרבות יהודית ישראלית (ציפורי)", is 29 characters, and
     43 subjects in that timetable are longer than the old 20-character
     working limit. Thirty covers the longest with headroom. */
  scheduleSubject: 30,
  /* A room is an identifier, not a sentence — but the identifier is
     sometimes a place: "מעבדת ביולוגיה" is fourteen characters, and
     rejecting it would send the office back to abbreviations nobody
     reads. The real timetable's longest room name is 17 characters;
     twenty is what fits the column at its own width with headroom. */
  scheduleRoom: 20,
  examSubject: 12,
  examRoom: 12,
  eventTitle: 22,
  eventLocation: 12,
  closureReason: 24,
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
var THEMES = ['כהה', 'בהירה', 'צבעונית 1', 'צבעונית 2'];

/* How the grade panes treat a lesson that is over. The board reads the
   chosen text, so these strings are part of the interface — changing one
   here without changing dashboard/logic.js silently reverts the board to
   its default. */
var LESSON_VIEW = ['הצג רק משיעור נוכחי ואילך', 'הצג את כל השיעורים ביום'];

/* Every row the הגדרות tab should contain, in order. Driving the tab
   from this list rather than from row numbers is what lets a second
   setting exist at all: the dropdown a row gets is decided by the NAME in
   column A, so the rows can be reordered, and a new setting can be added
   to an existing sheet without disturbing the choices already made. */
var SETTINGS = [
  { name: 'ערכת נושא', options: THEMES, def: 'כהה',
    help: 'ערכת נושא: ' + THEMES.join(' / ') },
  { name: 'אופן הצגת שיעורים', options: LESSON_VIEW, def: LESSON_VIEW[1],
    help: 'איך מוצגים שיעורים שכבר הסתיימו: ' + LESSON_VIEW.join(' / ') }
];

/* the אירועים tab's fixed columns, before the per-grade checkboxes */
var EVENT_FIXED = ['תאריך', 'כותרת', 'התחלה', 'סיום', 'מקום'];

/* How many event rows to prepare. The list is meant to hold only what is
   still live, so five is plenty — and onEdit extends the checkboxes
   automatically the moment a sixth event is typed in. */
var EVENT_MIN_ROWS = 5;

/* ---------- ימים ללא לימודים ----------
   Closures the ministry's calendar cannot know about: a school trip, an
   activity off site, a strike. Deliberately the SAME tick-box shape as
   אירועים, so the principal learns the pattern once and uses it twice.

   'עד תאריך' is optional — blank means the closure lasts a single day,
   which is the common case and should not cost a second date entry. */
var CLOSURE_TAB = 'ימים ללא לימודים';
var CLOSURE_FIXED = ['מתאריך', 'עד תאריך', 'סיבה'];

/* tabs whose validation onEdit knows how to restore after a paste */
var TAB_RULES = ['מערכת', 'מבחנים', 'אירועים', 'הודעות', 'הגדרות',
                 CLOSURE_TAB];

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
    { name: CLOSURE_TAB, seed: seedClosures_, style: styleClosures_ },
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
  if (name === CLOSURE_TAB) return rulesClosures_(sh);
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
  var seeded = [], styled = [], failed = [], notes = [];
  tabs_().forEach(function (tab) {
    try {
      var sh = ensureSheet_(ss, tab.name);
      var isNew = tab.seed(sh);
      /* A style pass may report on itself. מערכת does: it is the only tab
         whose skeleton this script rebuilds, so it is the only one whose
         success is worth stating rather than assuming. */
      var note = tab.style(sh);
      if (note) notes.push(note);
      applyRules_(sh, tab.name);
      (isNew ? seeded : styled).push(tab.name);
    } catch (err) {
      failed.push(tab.name + ': ' + err.message);
    }
  });

  if (failed.length) {
    /* The failures come FIRST. A toast is cut off at 400 characters, and
       the run that produced this message spent its one chance on a list
       of the tabs that worked, leaving the reason the fourth one did not
       below the cut. Whoever reads this needs the reason, not the roll
       call. The full text is in the execution log either way. */
    toast_(
      'ההרצה הושלמה חלקית — נכשלו:\n' + failed.join('\n') + '\n\n' +
      'לא נמחק מידע. אפשר להריץ שוב לאחר תיקון, ' +
      'או לפנות לאחראי הטכני עם הטקסט הזה.\n\n' +
      'הצליחו: ' + seeded.concat(styled).join(', '));
    return;
  }

  /* one short line per tab that has something to report — today only
     מערכת, saying that its grid was checked against the bell times */
  var report = notes.length ? '\n' + notes.join('\n') : '';

  if (!styled.length) {
    toast_(
      'הגיליון נבנה בהצלחה. (גרסת סקריפט ' + SCRIPT_VERSION + ')' +
      report + '\n\n' +
      'השלב הבא: שיתוף → גישה כללית → "כל מי שיש לו הקישור" (מציג),\n' +
      'או פרסום באינטרנט של כל גיליון בנפרד כ-CSV.\n' +
      'ראו את ההוראות המלאות בקובץ README.\n\n' +
      '─────────────────────────\n' + NO_PII_NOTE + localeNote_(locale));
    return;
  }

  toast_(
    'העיצוב והחוקים עודכנו. (גרסת סקריפט ' + SCRIPT_VERSION + ')' +
    report + '\n\n' +
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

    if (name === 'אירועים' || name === CLOSURE_TAB) {
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
  /* The grade boxes always sit immediately before כולם, so their start
     is derived from IT rather than from any one tab's fixed columns.
     That is what lets these helpers serve both אירועים (5 fixed columns)
     and ימים ללא לימודים (3) without either knowing about the other. */
  var firstGrade = allCol - GRADES.length;
  if (firstGrade < 2) return null;
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
  /* sixteen: four fixed columns, then a subject and a room per grade */
  var wantCols = SCHEDULE_FIXED_COLS + GRADES.length * 2;
  if (sh.getMaxColumns() < wantCols) {
    sh.insertColumnsAfter(sh.getMaxColumns(), wantCols - sh.getMaxColumns());
  }
  return sh;
}

/* ---------- talking to Sheets without being lied to ----------

   Apps Script does not execute a call the moment you make it. Writes,
   merges and unmerges are QUEUED, and a queued call that the server
   rejects reports its failure at the next FLUSH — the next call that
   reads or writes a cell — not at the line that made it. A try/catch
   wrapped around the call itself therefore catches nothing, and the
   error surfaces somewhere with no idea what it is about.

   That is not a theory. It is what version 0.200 did on the school's
   sheet: breakApart() was called on a range that ended inside a merged
   block, the rejection landed on the getValues() two lines below, the
   whole מערכת tab was reported as "failed" with a message about the
   wrong call, and the grid it was there to rebuild never got rebuilt.

   Hence the two helpers below: flush_() to make a queued failure surface
   HERE, and step_() to give it a name when it does. */

/** Empty the queue now, so a failure belongs to the call that caused it. */
function flush_() {
  if (typeof SpreadsheetApp.flush === 'function') SpreadsheetApp.flush();
}

/**
 * Run one step, and if it fails say WHICH step and on what, in Hebrew.
 *
 * "ההרצה הושלמה חלקית" plus a raw English stack trace is what debugging
 * blind looks like from the principal's side of the screen. Every step
 * that touches the sheet's structure goes through here.
 */
function step_(what, fn) {
  try {
    return fn();
  } catch (err) {
    throw new Error(what + ' — ' + (err && err.message ? err.message : err));
  }
}

/**
 * Break every merge that TOUCHES this range, one merge at a time, each
 * by its own full extent.
 *
 * THE BUG THIS EXISTS TO STOP, in full, because it cost a live run:
 *
 *   rebuildScheduleGrid_ used to call breakApart() on A2:A<lastRow>,
 *   where lastRow is judged by CONTENT. On the half-migrated tab the
 *   last day letter sat at row 72 in a merged block running A72:A77 —
 *   so the range ended on the block's first row. Sheets refuses to
 *   unmerge a range that only partially spans a merge (its own API
 *   documentation: "The range must not partially span any merge"), the
 *   refusal arrived at the next flush, outside the try/catch, and setup()
 *   reported the whole tab as failed while columns B-D kept the old
 *   eleven-period grid.
 *
 * getMergedRanges() hands back each merge in FULL, so unmerging them one
 * by one can never partially span anything, whatever shape the tab is
 * in. flush_() then proves it worked before the caller moves on.
 */
function breakMerges_(range) {
  var merged = range.getMergedRanges();
  for (var i = 0; i < merged.length; i++) merged[i].breakApart();
  flush_();
}

/* ---------- the only functions here that write cell contents -------
   Everything else in this file formats, validates, protects or annotates.
   Those operations reach the data rows freely — a background colour or a
   dropdown is stored beside a cell's value, not in place of it — which is
   how a design change can be applied to a sheet full of real timetable
   without disturbing a single subject name.

   tests/run.js enforces this mechanically: it walks the whole file and
   fails if any content-mutating call appears outside the short list of
   functions allowed to make one (the write helpers here, plus the two
   that answer a click in the אירועים tab). Keep it that way. */

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
 * The LAYOUT IS PASSED IN, from scheduleGeometry_, and that is the whole
 * defence against a split row. Computing it here from DAYS and PERIODS
 * would describe the grid as it was seeded; once the principal has
 * inserted rows for concurrent classes, the real blocks are taller, and
 * writing the seeded skeleton over them would slide every day letter up
 * the sheet — moving lessons to the wrong day without changing one
 * subject cell, which is the kind of damage nobody notices for a week.
 *
 * The board reads this column to group rows by day, and a merged cell
 * exports to CSV as its value on the first row and BLANKS below. That is
 * handled in buildSchedule(), which treats a blank day as "same as
 * above". The two must change together.
 */
function writeDayColumn_(sh, layout) {
  layout = layout || scheduleLayout_();
  var col = sh.getRange(2, 1, layout.total, 1);

  /* Whole column, one merge at a time: a block left over from a taller
     or shorter geometry can hang below layout.total, and a breakApart()
     stopping at layout.total's row would end inside it — the exact call
     that failed on the live sheet. See breakMerges_. */
  step_('ביטול מיזוג עמודת היום', function () {
    breakMerges_(sh.getRange(1, 1, sh.getMaxRows(), 1));
  });

  var vals = [];
  DAYS.forEach(function (d, di) {
    for (var i = 0; i < layout.counts[di]; i++) vals.push([i === 0 ? d : '']);
  });
  col.setValues(vals);

  DAYS.forEach(function (d, di) {
    sh.getRange(2 + layout.offsets[di], 1, layout.counts[di], 1).merge();
  });

  col.setFontSize(30)
     .setFontColor('#000000')
     .setFontWeight('bold')
     .setHorizontalAlignment('center')
     .setVerticalAlignment('middle');
}

/**
 * Rebuild the WHOLE script-owned skeleton — the period numbers and both
 * bell times, columns B, C and D — to the canonical grid.
 *
 * THE WRITE-SAFETY RULE, stated once, in full:
 *
 *   setup() writes the מערכת tab's script-owned columns A-D only while
 *   the tab holds NO subject and NO room. The moment one is present it
 *   writes COLUMN A ALONE — the day letters, over the blocks as they
 *   really stand — and it refuses the tab outright when the geometry
 *   underneath those subjects is an older, shorter one. It is therefore
 *   impossible for setup() to overwrite anything typed into columns E-P,
 *   because those columns are never written outside a seed of an empty
 *   tab, and impossible for it to move a lesson under the wrong period,
 *   because the only tab whose B-D it rewrites has no lessons in it.
 *
 * The bug this exists to fix: clearing the SUBJECT cells of a tab built
 * to the eleven-period grid, then running the new setup(), left columns
 * B-D holding eleven rows per day while column A was restated with
 * fourteen — period 1 at 08:30, a second period 0 halfway down Sunday,
 * and the day letters out of step with the times under them. Column A
 * was rebuilt; nothing rebuilt the rest.
 *
 * Four things happen here, in this order:
 *
 *   1. Every merged day block comes apart — one merge at a time, by its
 *      own extent, so a block hanging below the content ends nowhere
 *      awkward. writeDayColumn_ re-merges to the new geometry shortly
 *      after. (Version 0.200 did this with a single breakApart() over
 *      A2:A<lastRow> and that is precisely what failed live: see
 *      breakMerges_ for the full account.)
 *   2. Anything an older grid left BELOW the new one — a taller shape's
 *      trailing rows — is cleared, across the timetable's own sixteen
 *      columns. Columns past those are not the timetable's and are left
 *      alone; the grid rows' own E-P are already empty, which is the
 *      precondition for being here at all.
 *   3. The period numbers and bell times are written, and only if they
 *      differ from what is already there — compared as TIMES, through
 *      timeFraction_, so a number, a Date and the text "08:15" all
 *      compare equal. A tab already on this grid is a complete no-op,
 *      exactly like writeHeader_ on an unchanged header.
 *   4. The result is READ BACK and checked against the canonical grid.
 *      Nothing here reports success on the strength of having made the
 *      calls: the calls were made last time too, and the sheet kept the
 *      old grid anyway. If B-D still do not match, this throws, in
 *      Hebrew, naming the first row that is wrong.
 *
 * Returns true when it actually changed something.
 */
function rebuildScheduleGrid_(sh) {
  var layout = scheduleLayout_();
  var width = Math.min(scheduleHeaders_().length, sh.getMaxColumns());
  var bottom = 1 + layout.total;                 /* the last grid row: 77 */
  var changed = false;

  /* How far down the tab anything reaches. getValues() cannot see it on
     its own: a merged block shows its value on the top row only, so a
     day letter at row 72 hides a block running to row 77. */
  var dayCol = sh.getRange(1, 1, sh.getMaxRows(), 1);
  var last = scheduleLastRow_(sh);
  step_('קריאת מיזוגי עמודת היום', function () {
    var merged = dayCol.getMergedRanges();
    for (var i = 0; i < merged.length; i++) {
      last = Math.max(last, merged[i].getLastRow());
    }
  });

  step_('ביטול מיזוג עמודת היום', function () { breakMerges_(dayCol); });

  if (last > bottom) {
    var stale = sh.getRange(bottom + 1, 1, last - bottom, width);
    step_('ניקוי שורות ישנות מתחת לשורה ' + bottom, function () {
      if (!stale.isBlank()) { stale.clearContent(); changed = true; }
    });
  }

  var want = canonicalGridRows_();
  var rng = sh.getRange(2, 2, layout.total, 3);
  var have = step_('קריאת ' + rng.getA1Notation(), function () {
    return rng.getValues();
  });
  var same = true;
  for (var r = 0; r < want.length && same; r++) {
    if (Number(have[r][0]) !== want[r][0]) same = false;
    for (var c = 1; c < 3 && same; c++) {
      var mine = timeFraction_(have[r][c]);
      /* a second apart is the same bell — never compare floats exactly */
      if (mine === null || Math.abs(mine - timeFraction_(want[r][c])) > 1e-6) {
        same = false;
      }
    }
  }
  if (!same) {
    step_('כתיבת השיעורים והשעות ל-' + rng.getA1Notation(), function () {
      rng.setValues(want);
      flush_();
    });
    changed = true;
  }

  /* Verified, never assumed. */
  var bad = scheduleGridProblems_(sh, false);
  if (bad.length) {
    throw new Error('בניית עמודות השיעור והשעות לא נקלטה: ' + bad.join('; '));
  }
  return changed;
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
  /* Also drop whatever an EARLIER version of this script called the same
     range. Renaming a lock without this leaves the old protection behind
     over cells the new one already covers — harmless to look at, and
     impossible to reason about when someone asks who may edit what. */
  var legacy = LEGACY_LOCKS[description] || [];
  existing.forEach(function (p) {
    var d = p.getDescription();
    if (d === description || legacy.indexOf(d) >= 0) p.remove();
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

/**
 * Fraction of a day for a typed time, or null to leave the cell alone.
 *
 * This is how Sheets stores a time-of-day: 08:50 is 530/1440. No date
 * component and therefore no timezone — which is what the old "keep it
 * as text to avoid timezone surprises" comment was really worried about,
 * and it does not apply to a bare time.
 */
function timeValue_(v) {
  if (typeof v === 'number') return null;          /* already a time */
  var m = /^\s*(\d{1,2})[:.](\d{1,2})\s*$/.exec(String(v == null ? '' : v));
  if (!m) return null;
  var h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return (h * 60 + min) / 1440;
}

/**
 * Turn text like "8:50" in a time column into an actual time value.
 *
 * These columns used to be plain TEXT, which meant "8:50" stayed "8:50"
 * on screen — a number format cannot pad text — and a column of times
 * did not line up. Real time values let Sheets do the formatting itself,
 * out of the box, which is the right answer.
 *
 * That leaves the times already typed under the old scheme, so they are
 * converted here. Semantically lossless, bounded to the time columns,
 * and idempotent: a cell already holding a number is skipped, so the
 * second run and every run after it writes nothing at all.
 */
function convertTimeColumn_(sh, col) {
  var rng = sh.getRange(2, col, ruleRows_(sh));
  var vals = rng.getValues();
  var touched = false;
  for (var i = 0; i < vals.length; i++) {
    var t = timeValue_(vals[i][0]);
    if (t !== null) { vals[i][0] = t; touched = true; }
  }
  if (touched) rng.setValues(vals);
}

/**
 * A real time-of-day, displayed HH:MM.
 *
 * Type 8:50, 8.50 or 08:50 and Sheets parses all three and shows 08:50 —
 * no script involved. The rule only checks that what landed IS a
 * time-of-day (a number from midnight to just before midnight), and it
 * WARNS rather than refuses, for the same reason as the date rule: a
 * validator should never be the thing standing between the principal and
 * her own sheet.
 */
function timeRule_(sh, col) {
  convertTimeColumn_(sh, col);
  var n = ruleRows_(sh);
  var cell = 'INDIRECT("RC", FALSE)';
  var rule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied(
      '=AND(ISNUMBER(' + cell + '), ' + cell + '>=0, ' + cell + '<1)')
    .setAllowInvalid(true)
    .setHelpText('שעה ביום, למשל 8:50 או 08:50 — הגיליון יציג 08:50.\n' +
                 'תא שאינו נראה כשעה יסומן, אך לא ייחסם.')
    .build();
  sh.getRange(2, col, n)
    .setDataValidation(rule)
    .setNumberFormat('hh:mm')
    .setHorizontalAlignment('center');
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
     and period, so there is nothing to choose. Those columns are locked
     instead (see styleSchedule_). */
  timeRule_(sh, 3);
  timeRule_(sh, 4);
  /* Which columns are rooms is read back from the HEADER rather than
     computed from GRADES, so a sheet whose grade list differs from this
     script's — a school with a seventh grade column, or one still on the
     subject-only shape — gets the right rule on every column it has. */
  var last = Math.max(SCHEDULE_FIXED_COLS + 1, sh.getLastColumn());
  var headers = sh.getRange(1, 1, 1, last).getValues()[0];
  for (var c = SCHEDULE_FIXED_COLS + 1; c <= last; c++) {
    if (isRoomHeader_(headers[c - 1])) {
      lenRule_(sh, c, LIMITS.scheduleRoom, 'חדר');
    } else {
      lenRule_(sh, c, LIMITS.scheduleSubject, 'שם מקצוע');
    }
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
  var last = Math.max(2, sh.getLastRow());
  var names = sh.getRange(2, 1, last - 1, 1).getValues();

  /* Clear first, then give each row the list that belongs to ITS setting.
     The old rule put the theme dropdown down the whole column, which was
     harmless while there was one setting and wrong the moment there were
     two. */
  sh.getRange(2, 2, sh.getMaxRows() - 1).clearDataValidations();

  var applied = 0;
  names.forEach(function (row, i) {
    var name = String(row[0]).trim();
    for (var k = 0; k < SETTINGS.length; k++) {
      if (SETTINGS[k].name !== name) continue;
      sh.getRange(2 + i, 2).setDataValidation(
        SpreadsheetApp.newDataValidation()
          .requireValueInList(SETTINGS[k].options, true)
          .setAllowInvalid(false)
          .setHelpText(SETTINGS[k].help)
          .build());
      applied++;
    }
  });

  /* verify rather than assume: a missing dropdown here is invisible
     until someone tries to change a setting on a live board */
  if (applied < SETTINGS.length) {
    throw new Error('לא נוצרו כל התפריטים הנפתחים בגיליון "הגדרות" — ' +
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

  exclusiveTickRules_(sh);
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
  /* Scan whatever the tab's fixed columns are, not a hardcoded two: the
     closures tab keeps its reason in column 3, and a row holding only
     that must still count as used. */
  var cols = eventColumns_(sh);
  var width = cols ? cols.firstGrade - 1 : 2;
  var vals = sh.getRange(2, 1, last - 1, width).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    for (var c = 0; c < width; c++) {
      if (String(vals[i][c]).trim() !== '') return i + 2;
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
   Fourteen period rows — numbered 1 to 14, the numbers the school's own
   bell schedule uses — for every day except Friday. There is NO period
   0: the school day starts at 08:15 with period 1, and a "0" anywhere in
   this tab means the sheet is still on the old shape.

   The principal fills in subjects and rooms and leaves the rest empty —
   an empty cell simply means no class, so the day ends after the last
   subject entered. Nothing to add or delete, and no day to pick from a
   dropdown.

   Friday (יום ו׳) ends after period 6 (13:30): the school day there is
   shorter, so it never reaches periods 7-14 at all. That is what
   SHORT_DAYS below encodes, and it is also why nothing in this file may
   assume "every day has PERIODS.length rows" — the functions that used
   to make that assumption go through scheduleGeometry_ instead.

   TWO SHAPES OF ROW live in this tab, and the difference matters to
   every function below:

     • the SEEDED GRID — one row per day per period, 5x14 + 6 = 76 rows
       plus the header, written once into an empty tab;
     • rows the principal INSERTS herself, because one period splits into
       concurrent classes (a grade divided into groups, each group with
       its own subject and its own room). Real timetables here reach five
       concurrent classes in a single period.

   An inserted row repeats nothing: its יום/שיעור/התחלה/סיום cells stay
   blank, because those four columns are locked and she cannot type in
   them. The board reads a row with no time of its own as belonging to
   the lesson slot above it, and Sheets makes the day column agree by
   itself — a row inserted inside a merged block extends that merge, so
   the day letter still covers it.

   The cost of that freedom is that ROW NUMBERS STOP BEING PREDICTABLE
   the moment the sheet goes live. scheduleLayout_ below describes the
   grid as SEEDED; readDayBlocks_ reads back the blocks as they now
   ACTUALLY stand; scheduleGeometry_ picks between them. Everything that
   styles, locks or merges asks scheduleGeometry_, never the arithmetic. */
var PERIODS = [
  [1,  '08:15', '09:00'], [2,  '09:00', '09:45'],
  [3,  '10:10', '10:55'], [4,  '10:55', '11:40'],
  [5,  '12:00', '12:45'], [6,  '12:45', '13:30'],
  [7,  '14:00', '14:45'], [8,  '14:45', '15:30'],
  [9,  '15:30', '16:15'], [10, '16:15', '17:00'],
  [11, '17:00', '17:45'], [12, '17:45', '18:30'],
  [13, '18:30', '19:15'], [14, '19:15', '20:00']
];

/* Days that do not use every row in PERIODS, keyed by the DAYS label so
   this stays readable and stays data — not a scatter of "if day is ו"
   checks through the functions below. A day absent from this map gets
   the full PERIODS.length, via periodCount_'s fallback. */
var SHORT_DAYS = { 'ו': 6 };

/** How many of PERIODS the given day actually uses. */
function periodCount_(day) {
  return SHORT_DAYS[day] || PERIODS.length;
}

/**
 * The מערכת tab's row geometry AS SEEDED — five fourteen-period days
 * and a six-period Friday, 76 data rows in all, ending at row 77.
 *
 * offsets[i] is the 0-based row offset of day i, relative to row 2 (the
 * first data row); total is every day's rows added together.
 *
 * This is the shape a fresh tab is built to. It is NOT necessarily the
 * shape a live tab is in — see readDayBlocks_.
 */
function scheduleLayout_() {
  var counts = DAYS.map(periodCount_);
  var offsets = [];
  var total = 0;
  counts.forEach(function (c) {
    offsets.push(total);
    total += c;
  });
  return { counts: counts, offsets: offsets, total: total };
}

function scheduleHeaders_() {
  var head = ['יום', 'שיעור', 'התחלה', 'סיום'];
  GRADES.forEach(function (g) { head.push(g, roomHeader_(g)); });
  return head;
}

/**
 * The last row of the timetable, judged only by the columns the
 * timetable owns.
 *
 * getLastRow() answers for the whole sheet, so a note someone left in
 * column T at row 400 would stretch Friday's block to four hundred rows.
 * Scanning the header's own width keeps that out.
 */
function scheduleLastRow_(sh) {
  var width = Math.min(scheduleHeaders_().length, sh.getMaxColumns());
  var vals = sh.getRange(1, 1, sh.getMaxRows(), width).getValues();
  for (var r = vals.length - 1; r >= 1; r--) {
    for (var c = 0; c < width; c++) {
      if (String(vals[r][c]).trim() !== '') return r + 1;
    }
  }
  return 1;
}

/**
 * The day blocks as they ACTUALLY stand in the sheet, read back out of
 * column A — or null when column A holds nothing this script recognises.
 *
 * This is what makes an inserted split row safe. Sheets extends a merged
 * block when a row is inserted inside it, so the day letter stays on top
 * and the new row exports blank underneath: reading the letters back
 * gives the true per-day heights, where scheduleLayout_ would still be
 * describing the 76-row grid the tab had on the day it was seeded.
 * Writing THAT over a sheet with split rows in it would slide every day
 * letter up the sheet and silently reassign lessons to the wrong day.
 *
 * Returns null — meaning "no skeleton here, use the canonical one" — for
 * a fresh tab, and for the older shape that repeats the letter on every
 * row, which is a migration rather than a geometry worth preserving.
 */
function readDayBlocks_(sh) {
  var last = scheduleLastRow_(sh);
  if (last < 2) return null;
  var vals = sh.getRange(2, 1, last - 1, 1).getValues();
  var offsets = [];
  for (var i = 0; i < vals.length; i++) {
    var v = String(vals[i][0]).trim();
    if (!v) continue;
    /* the letters must be the days, once each, in order */
    if (v !== DAYS[offsets.length]) return null;
    offsets.push(i);
  }
  if (offsets.length !== DAYS.length) return null;
  if (offsets[0] !== 0) return null;             /* must start at row 2 */
  var counts = [];
  for (var d = 0; d < DAYS.length; d++) {
    counts.push((d + 1 < DAYS.length ? offsets[d + 1] : vals.length) -
                offsets[d]);
  }
  return { counts: counts, offsets: offsets, total: vals.length };
}

/** Does the tab hold anything the principal typed — a subject or room? */
function scheduleHasSubjects_(sh) {
  var first = SCHEDULE_FIXED_COLS + 1;
  if (sh.getMaxColumns() < first) return false;
  var last = scheduleLastRow_(sh);
  if (last < 2) return false;
  var width =
    Math.min(scheduleHeaders_().length, sh.getMaxColumns()) - first + 1;
  if (width < 1) return false;
  var vals = sh.getRange(2, first, last - 1, width).getValues();
  for (var r = 0; r < vals.length; r++) {
    for (var c = 0; c < width; c++) {
      if (String(vals[r][c]).trim() !== '') return true;
    }
  }
  return false;
}

/**
 * The geometry styleSchedule_ and writeDayColumn_ must agree on, in
 * four cases:
 *
 *   • NOTHING TYPED IN THE TAB → the canonical grid, unconditionally.
 *     With no subject and no room anywhere there is no lesson that could
 *     land under the wrong day, so whatever shape the tab is in is not
 *     worth preserving — it is a skeleton to be replaced. This is the
 *     one state in which rebuildScheduleGrid_ is allowed to restate
 *     columns B-D as well, and it must: writing new fourteen-row day
 *     letters over an old eleven-row grid's period numbers and bell
 *     times, and leaving those, is exactly the mess this case exists to
 *     stop. See the write-safety rule on rebuildScheduleGrid_.
 *   • no readable skeleton (a fresh tab, or the old repeated-letter
 *     shape) → the canonical grid, which is also the migration;
 *   • the current shape, at or above the canonical height → ITS OWN
 *     blocks, so rows inserted for concurrent classes survive;
 *   • a SHORTER shape that still holds subjects → an error. That is a
 *     sheet built to a previous version's geometry (eleven periods, no
 *     room columns), and restating the canonical skeleton over it would
 *     leave every subject under the wrong day, the wrong period and the
 *     wrong grade. With subjects present this script may only write
 *     column A, so it cannot repair that — it has to refuse, and say why.
 */
function scheduleGeometry_(sh) {
  var canonical = scheduleLayout_();
  if (!scheduleHasSubjects_(sh)) return canonical;

  var actual = readDayBlocks_(sh);
  if (!actual) return canonical;

  var shorter = false;
  for (var i = 0; i < canonical.counts.length; i++) {
    if (actual.counts[i] < canonical.counts[i]) shorter = true;
  }
  if (!shorter) return actual;

  throw new Error(
    'לשונית "מערכת" בנויה לפי מבנה ישן: ' + actual.total +
    ' שורות נתונים במקום ' + canonical.total + ', וכבר יש בה מקצועות. ' +
    'כדי לא להזיז שיעורים ליום ולשיעור הלא נכונים, הסקריפט לא נגע בה. ' +
    'יש להעתיק את התוכן לגיליון צדדי, למחוק את שורות הנתונים בלשונית ' +
    '"מערכת" (בלי למחוק את הלשונית עצמה) ולהריץ שוב.');
}

/* ---------- checking the skeleton instead of trusting it ----------

   Everything above decides what the מערכת tab SHOULD look like. This
   part reads back what it actually looks like, and it exists because
   version 0.200 shipped without it: the rebuild made all the right
   calls, one of them was rejected, and setup() had no way to tell the
   difference between "rebuilt" and "reported an error nobody could
   read". A grid is now correct only once it has been read back. */

/** The canonical B-D content: period number, start bell, end bell. */
function canonicalGridRows_() {
  var rows = [];
  DAYS.forEach(function (day) {
    var count = periodCount_(day);
    for (var p = 0; p < count; p++) {
      rows.push([PERIODS[p][0], PERIODS[p][1], PERIODS[p][2]]);
    }
  });
  return rows;
}

/**
 * A cell's time of day as a fraction of a day, whatever Sheets handed
 * back — and it hands back three different things for the same cell:
 *
 *   • a NUMBER (0.34375) — what a time value is underneath, and what the
 *     mock stores;
 *   • a DATE — what getValues() actually returns for a cell formatted as
 *     a time, on the real service, which is where this matters. The old
 *     comparison ran String() over it, got "Sat Dec 30 1899 08:15:00
 *     GMT+0200", failed to parse it and declared the grid different from
 *     itself. Every live run rewrote all 228 cells for nothing, and no
 *     test could see it because the mock only ever produced numbers;
 *   • TEXT ("08:15") — what this script writes, and what sits in a tab
 *     built before the times were converted.
 *
 * null when it is not a time at all.
 */
function timeFraction_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v - Math.floor(v);
  if (v instanceof Date || (v && typeof v.getHours === 'function')) {
    return (v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds()) / 86400;
  }
  return timeValue_(v);
}

/** A time cell as HH:MM, for saying what was found where. */
function timeText_(v) {
  var f = timeFraction_(v);
  if (f === null) return v === '' || v === null || v === undefined
    ? '(ריק)' : String(v);
  var mins = Math.round(f * 1440);
  return ('0' + Math.floor(mins / 60)).slice(-2) + ':' +
         ('0' + (mins % 60)).slice(-2);
}

/**
 * Everything wrong with the script-owned skeleton of the מערכת tab, in
 * Hebrew, read back out of the sheet. An empty list means the tab
 * matches the canonical grid exactly.
 *
 * withDays adds the day letters and the merged blocks, which only make
 * sense once writeDayColumn_ has run — rebuildScheduleGrid_ checks its
 * own three columns and nothing else.
 *
 * At most three problems are reported. This ends up inside a toast, and
 * a list of seventy-six wrong rows is not more informative than the
 * first three of them.
 */
function scheduleGridProblems_(sh, withDays) {
  var layout = scheduleLayout_();
  var headers = scheduleHeaders_();
  var bottom = 1 + layout.total;
  var bad = [];

  if (sh.getMaxRows() < bottom || sh.getMaxColumns() < headers.length) {
    bad.push('הלשונית קטנה מהנדרש: ' + sh.getMaxRows() + ' שורות ו-' +
             sh.getMaxColumns() + ' עמודות');
    return bad;
  }

  var want = canonicalGridRows_();
  var have = sh.getRange(2, 2, layout.total, 3).getValues();
  for (var r = 0; r < want.length && bad.length < 3; r++) {
    if (Number(have[r][0]) !== want[r][0]) {
      bad.push('שורה ' + (r + 2) + ': שיעור ' +
               (have[r][0] === '' ? '(ריק)' : have[r][0]) +
               ' במקום ' + want[r][0]);
      continue;
    }
    for (var c = 1; c < 3; c++) {
      var mine = timeFraction_(have[r][c]);
      if (mine === null ||
          Math.abs(mine - timeFraction_(want[r][c])) > 1e-6) {
        bad.push('שורה ' + (r + 2) + ': ' +
                 (c === 1 ? 'התחלה ' : 'סיום ') + timeText_(have[r][c]) +
                 ' במקום ' + want[r][c]);
        break;
      }
    }
  }

  /* nothing may survive below the grid's last row */
  if (bad.length < 3 && sh.getMaxRows() > bottom) {
    var width = Math.min(headers.length, sh.getMaxColumns());
    var below = sh.getRange(bottom + 1, 1, sh.getMaxRows() - bottom, width);
    if (!below.isBlank()) {
      bad.push('נשאר תוכן מתחת לשורה ' + bottom);
    }
  }

  if (!withDays) return bad;

  var colA = sh.getRange(2, 1, layout.total, 1).getValues();
  for (var d = 0; d < DAYS.length && bad.length < 3; d++) {
    var at = layout.offsets[d];
    if (String(colA[at][0]).trim() !== DAYS[d]) {
      bad.push('שורה ' + (at + 2) + ': יום ' +
               (colA[at][0] === '' ? '(ריק)' : colA[at][0]) +
               ' במקום ' + DAYS[d]);
    }
  }

  var wantMerges = [];
  DAYS.forEach(function (d, di) {
    wantMerges.push('A' + (2 + layout.offsets[di]) + ':A' +
                    (1 + layout.offsets[di] + layout.counts[di]));
  });
  var gotMerges = sh.getRange(1, 1, sh.getMaxRows(), 1).getMergedRanges()
    .sort(function (a, b) { return a.getRow() - b.getRow(); })
    .map(function (m) { return m.getA1Notation(); });
  if (gotMerges.join(',') !== wantMerges.join(',') && bad.length < 3) {
    bad.push('מיזוג עמודת היום: ' + (gotMerges.join(', ') || '(אין)') +
             ' במקום ' + wantMerges.join(', '));
  }
  return bad;
}

/* ---------- seeds: example content for an EMPTY tab only ---------- */

/**
 * Lay down the GRID and almost nothing else.
 *
 * The school's real timetable is transcribed from the principal's own
 * per-grade sheets, so a seed full of invented lessons is not a head
 * start — it is 76 rows of fiction to delete first. What the seed owes
 * her is the skeleton she cannot type herself: every day, every period,
 * its bell times, and an empty subject/room pair per grade.
 *
 * Two example lessons on Sunday stay, and only two: they show what a
 * filled subject-and-room pair looks like, which is not obvious from an
 * empty grid, and they are meant to be typed straight over.
 */
function seedSchedule_(sh) {
  var EXAMPLE = [
    ['מתמטיקה', 'חדר 12'], ['אנגלית', 'חדר 8'], ['לשון', 'חדר 3'],
    ['היסטוריה', 'חדר 21'], ['ביולוגיה', 'מעבדה'], ['פיזיקה', 'חדר 14']
  ];
  var rows = [];
  DAYS.forEach(function (day, di) {
    var count = periodCount_(day);
    for (var p = 0; p < count; p++) {
      var row = [day].concat(PERIODS[p]);
      GRADES.forEach(function (g, gi) {
        var show = di === 0 && p < 2;
        var ex = EXAMPLE[(gi + p) % EXAMPLE.length];
        row.push(show ? ex[0] : '', show ? ex[1] : '');
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
  return seedIfEmpty_(sh, SETTINGS.map(function (o) { return [o.name, o.def]; }));
}

/**
 * Add any setting row the tab does not have yet, and nothing else.
 *
 * seedIfEmpty_ cannot do this: it refuses a tab with anything in it, so
 * a setting added after the sheet was built would never appear. This
 * appends only NAMES THAT ARE ABSENT, below whatever is already there,
 * with the default in the value cell — so a choice the principal has
 * already made is never read, never compared and never overwritten.
 */
function ensureSettingRows_(sh) {
  var last = Math.max(1, sh.getLastRow());
  var have = {};
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
      have[String(r[0]).trim()] = true;
    });
  }
  var missing = SETTINGS.filter(function (o) { return !have[o.name]; })
                        .map(function (o) { return [o.name, o.def]; });
  if (!missing.length) return false;
  if (last + missing.length > sh.getMaxRows()) {
    sh.insertRowsAfter(sh.getMaxRows(), missing.length);
  }
  sh.getRange(last + 1, 1, missing.length, 2).setValues(missing);
  return true;
}

/* ---------- styles: applied to every tab, every run ----------
   These reach the data rows on purpose — that is where the grade tints,
   the day boxes and the locked columns belong. What they never do is
   read or replace what is typed in those rows. */

function styleSchedule_(sh) {
  /* Geometry first, and before anything is written: on a tab built to an
     older, shorter shape this throws, and setup() reports that one tab
     as failed instead of restating a skeleton its contents no longer
     fit. On a live tab with split rows in it, this is what returns the
     blocks as they really stand. */
  var layout = scheduleGeometry_(sh);
  /* The one state in which the script owns columns B-D as well as A: an
     empty tab, whose skeleton may therefore be replaced outright rather
     than only re-lettered. With a single subject or room present the
     rebuild is skipped and the run writes column A alone, as it always
     has. See the write-safety rule on rebuildScheduleGrid_.

     Both questions are asked HERE, before anything is written, because
     afterwards the answer would only describe this run's own work. */
  var empty = !scheduleHasSubjects_(sh);
  var broken = empty && scheduleGridProblems_(sh, true).length > 0;
  if (!scheduleHasSubjects_(sh)) rebuildScheduleGrid_(sh);
  var headers = scheduleHeaders_();
  writeHeader_(sh, headers);
  var rows = layout.total;

  /* Day, period and BOTH times are structural and script-written: the
     board groups rows by day and orders them by start time, so a stray
     edit here silently moves a class. Locking all four is also what
     makes an inserted split row unambiguous — the principal cannot fill
     them in, so a row with no time of its own can only mean "the same
     lesson slot as the row above", which is exactly what it does mean. */
  lock_(sh.getRange(2, 1, rows, SCHEDULE_FIXED_COLS), SCHEDULE_LOCK);
  /* Protection stops other editors but never the owner, so locked cells
     also LOOK locked. The grey BACKGROUND carries that signal on its own,
     like a form field you cannot type in; the text stays black, because
     these are the columns you actually read while finding the right row,
     and dimming them made the sheet harder to use for no gain in clarity
     about what is editable. */
  sh.getRange(2, 1, rows, SCHEDULE_FIXED_COLS)
    .setHorizontalAlignment('center')
    .setBackground('#f0f0f0')
    .setFontColor('#000000');
  /* after the block styling above, so the day letter's own size wins */
  writeDayColumn_(sh, layout);
  /* a faint band per day, so 76 rows stay readable */
  sh.getRange(2, 1, rows, headers.length).setBorder(
    null, null, null, null, null, true, '#d9d9d9',
    SpreadsheetApp.BorderStyle.SOLID);

  /* One colour per grade, matching that grade's card on the board, over
     BOTH of its columns — subject and room read as one group that way,
     and a subject typed into the next grade's column still stands out.
     The room itself is set smaller and grey: it is an annotation on the
     lesson beside it, not a second lesson. */
  GRADES.forEach(function (g, gi) {
    var col = gradeColumn_(gi);
    sh.getRange(1, col, 1, 2)
      .setBackground(GRADE_HEADER_TINTS[gi % GRADE_HEADER_TINTS.length]);
    sh.getRange(2, col, rows, 2)
      .setBackground(GRADE_TINTS[gi % GRADE_TINTS.length]);
    sh.getRange(2, col + 1, rows)
      .setFontSize(9)
      .setFontColor('#666666');
  });

  /* A thick box around each day's own rows — fourteen for every day
     except Friday, whose block is six, PLUS whatever rows have been
     inserted into it for concurrent classes. The height comes from
     layout.counts, which is why an inserted row lands inside its day's
     box instead of pushing the boxes out of step with the content. */
  DAYS.forEach(function (day, di) {
    sh.getRange(2 + layout.offsets[di], 1, layout.counts[di], headers.length)
      .setBorder(true, true, true, true, null, null,
                 '#555555', SpreadsheetApp.BorderStyle.SOLID_THICK);
  });

  sh.setColumnWidth(1, 60);
  sh.setColumnWidth(2, 70);
  sh.setColumnWidths(3, 2, 80);
  GRADES.forEach(function (g, gi) {
    sh.setColumnWidth(gradeColumn_(gi), 120);
    sh.setColumnWidth(gradeColumn_(gi) + 1, 75);
  });
  sh.getRange('A1').setNote(
    'ארבעה-עשר שיעורים בימים א׳-ה׳, ממוספרים 1 עד 14, מוכנים מראש.\n' +
    'ביום ו׳ יש שישה בלבד (1 עד 6) — הלימודים שם מסתיימים ב-13:30.\n' +
    'אין "שיעור 0": היום מתחיל בשיעור 1 בשעה 08:15.\n\n' +
    'לכל שכבה שתי עמודות: המקצוע, ולידו החדר. ממלאים רק אותן.\n' +
    'תא ריק = אין שיעור. יום הלימודים מסתיים אחרי המקצוע האחרון\n' +
    'שהוזן, וכל מה שאחריו לא יוצג על הלוח.\n\n' +
    'שיעור שמתפצל לכמה קבוצות באותה שעה: לוחצים לחיצה ימנית על שורת\n' +
    'השיעור ובוחרים "הוספת שורה מתחת", ובשורה החדשה ממלאים רק את\n' +
    'המקצוע והחדר של הקבוצה הנוספת. משאירים את עמודות היום, השיעור\n' +
    'והשעות ריקות — הלוח מבין ששורה כזו שייכת לשיעור שמעליה.\n\n' +
    'העמודות "יום", "שיעור", "התחלה" ו"סיום" נעולות — אין למלא בהן.');

  /* The last word on this tab, and the only one setup() is allowed to
     believe: read the finished skeleton back — day letters, merges,
     periods and both bells — and refuse to call the run a success on a
     tab that still does not match. A silent half-repair is exactly the
     failure that reached the principal's screen twice. */
  if (!empty) return '';
  var bad = scheduleGridProblems_(sh, true);
  if (bad.length) {
    throw new Error('הלוח בלשונית "מערכת" עדיין אינו תקין: ' + bad.join('; '));
  }
  return broken ? 'מערכת: הלוח נבנה מחדש ואומת ✓'
                : 'מערכת: הלוח נבדק ואומת ✓';
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
  ensureSettingRows_(sh);

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
    '  צבעונית 1 — רקע בהיר וגוון עדין לכל שכבה\n  צבעונית 2 — רקע כהה וכרטיסים צבעוניים בולטים\n\n' +
    'המבנה, הגדלים והגופנים זהים בכל הערכות — רק הצבעים מתחלפים.');
}

/* ==================================================================
   ימים ללא לימודים — closures the ministry's calendar cannot know about
   ================================================================== */

/**
 * Example rows, written only into a genuinely empty tab.
 *
 * Both examples are deliberately dated in the PAST. A seeded row dated
 * today would take effect the instant it was written: the כולם example
 * would blank the entire board, so the principal's first sight of the
 * feature would be an empty screen she never asked for. Past dates teach
 * the shape and change nothing on the wall.
 */
function seedClosures_(sh) {
  var from = new Date(); from.setDate(from.getDate() - 14);
  var to = new Date();   to.setDate(to.getDate() - 12);
  var trip = [from, to, 'טיול שנתי'];
  var strike = [from, '', 'שביתה'];
  GRADES.forEach(function (g, gi) {
    trip.push(gi === 2 ? true : '');    /* ט׳ alone — a per-grade closure */
    strike.push('');                    /* whole school, via כולם below */
  });
  trip.push('');
  strike.push(true);
  return seedIfEmpty_(sh, [trip, strike]);
}

function styleClosures_(sh) {
  var TICKS = GRADES.concat(['כולם']);
  writeHeader_(sh, CLOSURE_FIXED.concat(TICKS));

  var firstGradeCol = CLOSURE_FIXED.length + 1;
  sh.setColumnWidth(1, 120);
  sh.setColumnWidth(2, 120);
  sh.setColumnWidth(3, 300);
  sh.setColumnWidths(firstGradeCol, TICKS.length, 60);

  sh.getRange('A1').setNote(
    'ימים שבהם אין לימודים מסיבה בית-ספרית — טיול שנתי, פעילות מחוץ\n' +
    'לבית הספר, שביתה וכדומה.\n\n' +
    'חופשות משרד החינוך כבר מוגדרות בלוח עצמו ואין צורך להזין אותן כאן.\n\n' +
    'שורות הדוגמה מתוארכות לעבר ואינן משפיעות על הלוח — אפשר למחוק אותן.\n\n' +
    NO_PII_NOTE);
  sh.getRange('B1').setNote(
    'אפשר להשאיר ריק — סגירה של יום אחד בלבד.\n' +
    'לטיול או לאירוע רב-יומי: התאריך האחרון שבו אין לימודים.');
  sh.getRange('C1').setNote(
    'הטקסט שיוצג על הלוח, למשל "טיול שנתי".\n' +
    'עד ' + LIMITS.closureReason + ' תווים.');
  sh.getRange(1, firstGradeCol, 1, GRADES.length).setNote(
    'לסמן ✓ בכל שכבה שאין לה לימודים.\n' +
    'הלוח יסתיר את מערכת השעות של אותן שכבות בלבד, ויציג במקומה את הסיבה.');
  sh.getRange(1, firstGradeCol + GRADES.length).setNote(
    'אין לימודים בכל בית הספר — לסמן ✓ כאן במקום לסמן כל שכבה בנפרד.\n' +
    'הלוח יציג מסך אחד עם הסיבה, בלי מערכת שעות ובלי הודעות.');
}

function rulesClosures_(sh) {
  dateRule_(sh, 1);
  dateRule_(sh, 2);
  dateFlags_(sh, 1, 3);          /* flag a reason typed with no date */
  lenRule_(sh, 3, LIMITS.closureReason, 'סיבה');
  exclusiveTickRules_(sh);
}

/**
 * Tick boxes on the grade columns, plus the conditional formatting that
 * warns when כולם and an individual grade are ticked on the same row.
 *
 * Shared by אירועים and ימים ללא לימודים. Every column position comes
 * from eventColumns_ rather than from either tab's own constants, so the
 * two tabs can carry different fixed columns and still behave identically
 * — and a third tab in the same shape would need no changes here at all.
 */
function exclusiveTickRules_(sh) {
  var cols = eventColumns_(sh);
  if (!cols) {
    throw new Error('לא נמצאה עמודת "כולם" בגיליון "' + sh.getName() + '".');
  }
  ensureEventBoxes_(sh);
  var firstGradeCol = cols.firstGrade;
  var lastCol = cols.allCol;

  /* Conditional formatting is evaluated by the browser, so it reacts the
     INSTANT a box is ticked — unlike onEdit, which is a server-side
     trigger and lands a moment later. Painting exactly the redundant
     grade boxes red gives immediate feedback about what is about to be
     cleared, and it keeps working even with no script in the project. */
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
    .setRanges([sh.getRange(2, firstGradeCol, 200, cols.gradeCount)])
    .build();

  var rules = sh.getConditionalFormatRules().filter(function (r) {
    /* drop our previous copies so re-running does not stack rules */
    var c = r.getBooleanCondition();
    return !c || String(c.getCriteriaValues()).indexOf(marker) < 0;
  });
  rules.push(onAll, onGrades);
  sh.setConditionalFormatRules(rules);

  if (!sh.getRange(2, firstGradeCol).getDataValidation()) {
    throw new Error('לא נוצרו תיבות סימון בגיליון "' + sh.getName() + '".');
  }
}
