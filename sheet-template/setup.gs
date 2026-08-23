/**
 * setup.gs — run ONCE to build the corridor-board spreadsheet.
 *
 * Creates four tabs (מערכת / מבחנים / אירועים / הודעות), right-to-left,
 * with headers, sample rows, and data validation that rejects anything
 * the dashboard cannot display — including per-field length limits
 * derived from the pixel budget of each element on the 1920x1080 board.
 *
 * How to run: Extensions -> Apps Script, paste this file, Run "setup",
 * authorize when asked. Safe to re-run: it clears and rebuilds the tabs.
 */

/* Bump when this file changes. Run checkVersion() to see which copy the
   Apps Script project is actually executing — Apps Script merges every
   file in the project, so an old Code.gs left behind will quietly win
   over a newer paste. */
var SCRIPT_VERSION = '0.151';

/** Run this to confirm which version of the script is loaded. */
function checkVersion() {
  SpreadsheetApp.getUi().alert(
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
  messageUrgent: 75
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
var THEMES = ['כהה', 'בהירה', 'צבעונית'];

/* the אירועים tab's fixed columns, before the per-grade checkboxes */
var EVENT_FIXED = ['תאריך', 'כותרת', 'התחלה', 'סיום', 'מקום'];

/* tabs whose validation onEdit knows how to restore after a paste */
var TAB_RULES = ['מערכת', 'מבחנים', 'אירועים', 'הודעות', 'הגדרות'];

/* The link header spells out what belongs in it, because "קישור" alone
   invites any URL. The board matches this column by its leading word,
   so the parenthetical can be reworded freely. */
var MESSAGE_HEADERS = ['הודעה', 'סוג',
                       'קישור לוידאו (Google Drive או YouTube)', 'סאונד',
                       'מתאריך', 'עד תאריך', 'פעיל'];

/** Re-apply one tab's dropdowns, checkboxes and limits. */
function applyRules_(sh, name) {
  if (name === 'מערכת')  return rulesSchedule_(sh);
  if (name === 'מבחנים') return rulesExams_(sh);
  if (name === 'אירועים') return rulesEvents_(sh);
  if (name === 'הודעות') return rulesMessages_(sh);
  if (name === 'הגדרות') return rulesSettings_(sh);
}

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetLocale('he_IL');
  ss.setSpreadsheetTimeZone('Asia/Jerusalem');

  /* Build each tab under its own guard. Without this, one bad call aborts
     the run with a stack trace and leaves the tab it was working on
     already cleared — which reads as "the script wiped my data". */
  var built = [], failed = [];
  [['מערכת', buildSchedule_], ['מבחנים', buildExams_],
   ['אירועים', buildEvents_], ['הודעות', buildMessages_],
   ['הגדרות', buildSettings_]].forEach(function (pair) {
    try {
      pair[1](sheet_(ss, pair[0]));
      built.push(pair[0]);
    } catch (err) {
      failed.push(pair[0] + ': ' + err.message);
    }
  });

  /* drop the default empty sheet if it is still around */
  var extra = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
  if (extra && ss.getSheets().length > 5) ss.deleteSheet(extra);

  if (failed.length) {
    SpreadsheetApp.getUi().alert(
      'הבנייה הושלמה חלקית.\n\n' +
      'נבנו: ' + built.join(', ') + '\n\n' +
      'נכשלו:\n' + failed.join('\n') + '\n\n' +
      'יש להריץ שוב לאחר תיקון, או לפנות לאחראי הטכני עם הטקסט הזה.');
    return;
  }

  SpreadsheetApp.getUi().alert(
    'הגיליון נבנה בהצלחה. (גרסת סקריפט ' + SCRIPT_VERSION + ')\n\n' +
    'השלב הבא: שיתוף → גישה כללית → "כל מי שיש לו הקישור" (מציג),\n' +
    'או פרסום באינטרנט של כל גיליון בנפרד כ-CSV.\n' +
    'ראו את ההוראות המלאות בקובץ README.\n\n' +
    '─────────────────────────\n' + NO_PII_NOTE);
}

/**
 * onEdit — runs automatically on every manual edit (a "simple trigger":
 * nothing to install, and it works for every editor of the sheet, not
 * just the owner).
 *
 * Its only job: keep כולם and the individual grade boxes mutually
 * exclusive in the אירועים tab. Tick a grade and כולם clears; tick כולם
 * and every grade clears. Without this an event could claim to be both
 * "all grades" and "just י׳", and the board would have to guess.
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

    if (name === 'אירועים') enforceExclusive_(sh, e.range);
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
      .addItem('גרסת הסקריפט', 'checkVersion')
      .addToUi();
  } catch (e) {}
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
  SpreadsheetApp.getUi().alert('החוקים הוחזרו בגיליונות: ' + done.join(', '));
}

/**
 * כולם and the individual grades are mutually exclusive. If both are set
 * in a row — by a tick or by a paste — כולם wins and the grades clear.
 * Pass a range to check only the rows it touches, or null for every row.
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

function sheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  sh.clearConditionalFormatRules();
  /* clearDataValidations() lives on Range, not on Sheet — clearing them
     matters because sh.clear() leaves old dropdowns and checkboxes behind,
     which would then conflict with the rules set below. */
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  try { sh.setRightToLeft(true); } catch (e) {}
  /* A sheet converted from an uploaded CSV arrives sized to its data
     (sometimes 2x2). Any later setDataValidation() over a taller range
     would throw "out of bounds" and abort the whole script, so make
     room up front. */
  if (sh.getMaxRows() < 100) {
    sh.insertRowsAfter(sh.getMaxRows(), 100 - sh.getMaxRows());
  }
  if (sh.getMaxColumns() < 12) {
    sh.insertColumnsAfter(sh.getMaxColumns(), 12 - sh.getMaxColumns());
  }
  return sh;
}

function header_(sh, headers) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold')
    .setBackground('#efefef');
  sh.setFrozenRows(1);
  /* Headers are structural: the board finds its columns by these names,
     so a well-meaning rename silently empties a panel. Genuinely locked,
     not merely warned about. */
  lock_(sh.getRange(1, 1, 1, sh.getMaxColumns()), 'כותרות — לא לשינוי');
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

/** Text-length rule with a Hebrew rejection message. */
function lenRule_(sh, col, max, label) {
  var rng = sh.getRange(2, col, 500);
  var rule = SpreadsheetApp.newDataValidation()
    .requireFormulaSatisfied('=LEN(INDIRECT("RC", FALSE))<=' + max)
    .setAllowInvalid(false)
    .setHelpText(label + ': עד ' + max + ' תווים (מגבלת רוחב במסך).')
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

/** Date rule — real dates only. */
function dateRule_(sh, col) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireDate()
    .setAllowInvalid(false)
    .setHelpText('תאריך, למשל 01/09/2026')
    .build();
  sh.getRange(2, col, 500).setDataValidation(rule);
  sh.getRange(2, col, 500).setNumberFormat('yyyy-mm-dd');
}

/* ---------- validation rules, separated so they can be restored ----------
   Everything here is NATIVE Google Sheets validation, which lives in the
   document itself. It survives the Apps Script project being deleted; only
   the automatic re-application after a paste needs the script. */

function rulesSchedule_(sh) {
  listRule_(sh, 1, DAYS, 'יום');
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
      '=LEN(INDIRECT("RC", FALSE))<=IF(INDIRECT("RC[1]", FALSE)="דחופה",' +
      LIMITS.messageUrgent + ',' + LIMITS.messageNormal + ')')
    .setAllowInvalid(false)
    .setHelpText('הודעה רגילה: עד ' + LIMITS.messageNormal + ' תווים. ' +
                 'הודעה דחופה: עד ' + LIMITS.messageUrgent + ' תווים.')
    .build();
  sh.getRange(2, 1, 500).setDataValidation(textRule);

  listRule_(sh, 2, TYPES, 'סוג');
  listRule_(sh, 4, YESNO, 'סאונד');   /* audio on/off, default לא */
  dateRule_(sh, 5);
  dateRule_(sh, 6);
  listRule_(sh, 7, YESNO, 'פעיל');
}

function rulesSettings_(sh) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(THEMES, true)
    .setAllowInvalid(false)
    .setHelpText('ערכת נושא: ' + THEMES.join(' / '))
    .build();
  sh.getRange(2, 2, Math.max(2, sh.getMaxRows() - 1)).setDataValidation(rule);
}

function rulesExams_(sh) {
  dateRule_(sh, 1);
  listRule_(sh, 2, GRADES, 'שכבה');
  lenRule_(sh, 3, LIMITS.examSubject, 'מקצוע');
  timeRule_(sh, 4);
  timeRule_(sh, 5);
  lenRule_(sh, 6, LIMITS.examRoom, 'מקום');
}

function rulesEvents_(sh) {
  dateRule_(sh, 1);
  lenRule_(sh, 2, LIMITS.eventTitle, 'כותרת');
  timeRule_(sh, 3);
  timeRule_(sh, 4);
  lenRule_(sh, 5, LIMITS.eventLocation, 'מקום');

  /* checkboxes down each grade column and under כולם */
  var tickCount = GRADES.length + 1;
  var firstGradeCol = EVENT_FIXED.length + 1;
  var boxes = sh.getRange(2, firstGradeCol, 200, tickCount);
  boxes.insertCheckboxes();
  boxes.setHorizontalAlignment('center');

  /* Native conditional formatting flags the contradictory state in red.
     This is the part that keeps working with no script at all: if the
     Apps Script project is ever deleted, a conflicting row still shows
     as obviously wrong instead of quietly misleading anyone. */
  var lastCol = firstGradeCol + tickCount - 1;
  var a1All = colLetter_(lastCol);
  var a1From = colLetter_(firstGradeCol);
  var a1To = colLetter_(lastCol - 1);
  var target = sh.getRange(2, 1, 200, lastCol);
  var rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND($' + a1All + '2=TRUE, COUNTIF($' + a1From +
                          '2:$' + a1To + '2, TRUE)>0)')
    .setBackground('#f4c7c3')
    .setRanges([target])
    .build();
  var rules = sh.getConditionalFormatRules().filter(function (r) {
    /* drop our previous copy so re-running does not stack rules */
    return String(r.getBooleanCondition() &&
      r.getBooleanCondition().getCriteriaValues()).indexOf('COUNTIF($' + a1From) < 0;
  });
  rules.push(rule);
  sh.setConditionalFormatRules(rules);

  if (!sh.getRange(2, firstGradeCol).getDataValidation()) {
    throw new Error('לא נוצרו תיבות סימון בגיליון "אירועים".');
  }
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

/* ---------- tab builders ---------- */

function buildSchedule_(sh) {
  var headers = ['יום', 'שיעור', 'התחלה', 'סיום'].concat(GRADES);
  header_(sh, headers);

  /* Seed a full plausible week, so the board looks like a real board
     the moment the sheet is published — easier to sanity-check on the
     TV than three lonely rows. Replace with the real timetable. */
  var PERIODS = [
    [1, '08:00', '08:45'], [2, '08:50', '09:35'], [3, '09:50', '10:35'],
    [4, '10:40', '11:25'], [5, '11:45', '12:30'], [6, '12:35', '13:20'],
    [7, '13:30', '14:15'], [8, '14:20', '15:05']
  ];
  var SUBJECTS = ['מתמטיקה', 'אנגלית', 'לשון', 'היסטוריה', 'ביולוגיה',
                  'פיזיקה', 'כימיה', 'ספרות', 'תנ"ך', 'אזרחות',
                  'חינוך גופני', 'מחשבים'];
  var rows = [];
  DAYS.forEach(function (day, di) {
    /* Friday is a short day; other days run 6-8 periods */
    var count = day === 'ו' ? 4 : (di % 2 === 0 ? 8 : 6);
    for (var p = 0; p < count; p++) {
      var row = [day].concat(PERIODS[p]);
      GRADES.forEach(function (g, gi) {
        /* upper grades keep going in the last periods; lower ones stop */
        var late = p >= 6 && gi < 2;
        row.push(late ? '' : SUBJECTS[(di * 5 + p * 3 + gi * 7) % SUBJECTS.length]);
      });
      rows.push(row);
    }
  });
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);

  rulesSchedule_(sh);
  sh.setColumnWidth(1, 60);
  sh.setColumnWidth(2, 70);
  sh.setColumnWidths(3, 2, 80);
  sh.setColumnWidths(5, GRADES.length, 130);
  sh.getRange('A1').setNote(
    'שורה לכל (יום, שיעור). תא ריק = אין שיעור.\n' +
    'כל עמודה אחרי "סיום" היא שכבה — הלוח מתאים את עצמו אוטומטית.');
}

function buildExams_(sh) {
  var headers = ['תאריך', 'שכבה', 'מקצוע', 'התחלה', 'סיום', 'חדר'];
  header_(sh, headers);
  /* dated today so they appear on the board straight away */
  var today = new Date();
  sh.getRange(2, 1, 3, headers.length).setValues([
    [today, GRADES[2], 'מתמטיקה', '09:00', '10:30', 'חדר 12'],
    [today, GRADES[5], 'אנגלית', '11:45', '12:30', 'ספרייה'],
    [today, GRADES[1], 'ביולוגיה', '12:35', '13:20', 'מעבדה']
  ]);

  rulesExams_(sh);
  sh.setColumnWidths(1, headers.length, 110);
  sh.getRange('C1').setNote(
    'להזין את שם המקצוע בלבד — הלוח מוסיף מעצמו "מבחן ב".');
  sh.getRange('B1').setNote(NO_PII_NOTE);
}

/* An event can apply to several grades. Google Sheets cannot multi-select
   inside one cell, so each grade gets its own checkbox column — tick as
   many as apply, and the board shows whichever are ticked. */
function buildEvents_(sh) {
  var FIXED = EVENT_FIXED;
  /* ...GRADES, then a כולם box for a whole-school activity, so nobody has
     to tick every grade one at a time. onEdit() keeps כולם and the
     individual grades mutually exclusive. */
  var TICKS = GRADES.concat(['כולם']);
  var headers = FIXED.concat(TICKS);
  header_(sh, headers);

  var today = new Date();
  var first = [today, 'חזרה כללית לטקס', '10:40', '11:25', 'אולם ספורט'];
  var second = [today, 'הרצאה: בטיחות ברשת', '12:35', '13:20', 'אודיטוריום'];
  var third = [today, 'עצרת פתיחת שנה', '08:00', '08:45', 'רחבת בית הספר'];
  GRADES.forEach(function (g, gi) {
    first.push(gi < 2);              /* ז׳, ח׳            */
    second.push(gi >= 3);            /* י׳ ומעלה          */
    third.push(false);               /* כולם instead      */
  });
  first.push(false);
  second.push(false);
  third.push(true);                  /* the כולם box      */
  sh.getRange(2, 1, 3, headers.length).setValues([first, second, third]);

  rulesEvents_(sh);

  var firstGradeCol = FIXED.length + 1;
  sh.setColumnWidths(1, FIXED.length, 130);
  sh.setColumnWidths(firstGradeCol, TICKS.length, 60);
  sh.getRange(1, firstGradeCol, 1, GRADES.length).setNote(
    'לסמן ✓ בכל שכבה שהאירוע מיועד לה.\n' +
    'מארבע שכבות ומעלה הלוח מציג "כולם".');
  sh.getRange(1, firstGradeCol + GRADES.length).setNote(
    'אירוע לכל בית הספר — לסמן ✓ כאן במקום לסמן כל שכבה בנפרד.\n' +
    'הלוח יציג "כולם".');

  /* verify rather than assume — a missing checkbox column is the kind of
     failure nobody notices until an event shows no grades at all */
  if (!sh.getRange(2, firstGradeCol).getDataValidation()) {
    throw new Error('לא נוצרו תיבות סימון בגיליון "אירועים".');
  }
}

function buildMessages_(sh) {
  var headers = MESSAGE_HEADERS;
  header_(sh, headers);
  sh.getRange(2, 1, 4, headers.length).setValues([
    ['אסיפת הורים ביום שלישי בשעה 19:00', 'רגילה', '', 'לא', '', '', 'כן'],
    ['מחר: יום כחול-לבן — באים בלבוש חגיגי', 'רגילה', '', 'לא', '', '', 'כן'],
    ['שיעורי שכבת ז׳ מסתיימים היום ב-13:20', 'דחופה', '', 'לא', '', '', 'כן'],
    ['ההסעה לקו הדרומי יוצאת ב-14:00 מהשער האחורי', 'דחופה', '', 'לא', '', '', 'כן']
  ]);

  rulesMessages_(sh);
  sh.setColumnWidth(1, 400);
  sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 300);
  sh.setColumnWidth(4, 80);
  sh.setColumnWidths(5, 2, 110);
  sh.setColumnWidth(7, 70);
  sh.getRange('C1').setNote(
    'רק לסוג "וידאו".\n\n' +
    'מותר להדביק כאן:\n' +
    '  • קישור יוטיוב (מהדפדפן — watch, youtu.be או Shorts)\n' +
    '  • קישור שיתוף של קובץ וידאו בגוגל דרייב\n\n' +
    'חשוב: קובץ בדרייב חייב להיות משותף ל"כל מי שיש לו הקישור".\n' +
    'קישור לתיקייה או לדף אינטרנט לא יעבוד.');
  sh.getRange('D1').setNote(
    'האם להשמיע את הסאונד של הסרטון.\n' +
    'ברירת המחדל "לא" — סרטון מושתק, כדי לא להפריע במסדרון.');
  sh.getRange('E1').setNote('טווח תאריכים להצגה. ריק = תמיד.');
  sh.getRange('G1').setNote('"לא" מסתיר את ההודעה בלי למחוק אותה.');
  sh.getRange('A1').setNote(NO_PII_NOTE);
}

/* Presentation settings the principal can change without touching code.
   A plain key/value tab, so more settings can be added later without
   changing its shape. */
function buildSettings_(sh) {
  header_(sh, ['הגדרה', 'ערך']);
  sh.getRange(2, 1, 1, 2).setValues([['ערכת נושא', 'כהה']]);

  /* The setting NAMES are structural — the board matches on them. Lock
     the whole column so only the value column is editable. */
  lock_(sh.getRange(2, 1, sh.getMaxRows() - 1), 'שמות הגדרות — לא לשינוי');

  var themeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(THEMES, true)
    .setAllowInvalid(false)
    .setHelpText('ערכת נושא: ' + THEMES.join(' / '))
    .build();
  sh.getRange(2, 2, 50).setDataValidation(themeRule);

  /* verify rather than assume: a missing dropdown here is invisible
     until someone tries to change the theme on a live board */
  var check = sh.getRange('B2').getDataValidation();
  if (!check) {
    throw new Error('התפריט הנפתח של ערכת הנושא לא נוצר — יש להריץ fix-settings.gs');
  }

  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(2, 160);
  sh.getRange('B1').setNote(
    'ערכת נושא של הלוח — בחירה מהתפריט והלוח מתחלף בתוך דקה:\n' +
    '  כהה — רקע שחור (ברירת המחדל; הידידותית ביותר למסך OLED)\n' +
    '  בהירה — רקע לבן, למסדרון מואר\n' +
    '  צבעונית — רקע כחול-כהה עם צבע לכל שכבה\n\n' +
    'המבנה, הגדלים והגופנים זהים בכל הערכות — רק הצבעים מתחלפים.');
}
