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

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetLocale('he_IL');
  ss.setSpreadsheetTimeZone('Asia/Jerusalem');

  buildSchedule_(sheet_(ss, 'מערכת'));
  buildExams_(sheet_(ss, 'מבחנים'));
  buildEvents_(sheet_(ss, 'אירועים'));
  buildMessages_(sheet_(ss, 'הודעות'));
  buildSettings_(sheet_(ss, 'הגדרות'));

  /* drop the default empty sheet if it is still around */
  var extra = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
  if (extra && ss.getSheets().length > 5) ss.deleteSheet(extra);

  SpreadsheetApp.getUi().alert(
    'הגיליון נבנה בהצלחה.\n\n' +
    'השלב הבא: קובץ → שיתוף → פרסום באינטרנט,\n' +
    'ולפרסם כל אחד מחמשת הגיליונות בנפרד כ-CSV.\n' +
    'ראו את ההוראות המלאות בקובץ README.\n\n' +
    '─────────────────────────\n' + NO_PII_NOTE);
}

/* ---------- helpers ---------- */

function sheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  sh.clearDataValidations();
  sh.clearConditionalFormatRules();
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
  sh.getRange(1, 1, 1, headers.length).protect()
    .setDescription('כותרות — נא לא לשנות')
    .setWarningOnly(true);
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

  listRule_(sh, 1, DAYS, 'יום');
  timeRule_(sh, 3);
  timeRule_(sh, 4);
  for (var c = 5; c <= headers.length; c++) {
    lenRule_(sh, c, LIMITS.scheduleSubject, 'שם מקצוע');
  }
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

  dateRule_(sh, 1);
  listRule_(sh, 2, GRADES, 'שכבה');
  lenRule_(sh, 3, LIMITS.examSubject, 'מקצוע');
  timeRule_(sh, 4);
  timeRule_(sh, 5);
  lenRule_(sh, 6, LIMITS.examRoom, 'מקום');
  sh.setColumnWidths(1, headers.length, 110);
  sh.getRange('C1').setNote(
    'להזין את שם המקצוע בלבד — הלוח מוסיף מעצמו "מבחן ב".');
  sh.getRange('B1').setNote(NO_PII_NOTE);
}

function buildEvents_(sh) {
  var headers = ['תאריך', 'שכבות', 'כותרת', 'התחלה', 'סיום', 'מקום'];
  header_(sh, headers);
  var today = new Date();
  sh.getRange(2, 1, 2, headers.length).setValues([
    [today, GRADES[0] + ', ' + GRADES[1], 'חזרה כללית לטקס', '10:40', '11:25', 'אולם ספורט'],
    [today, GRADES[3] + ', ' + GRADES[4] + ', ' + GRADES[5],
     'הרצאה: בטיחות ברשת', '12:35', '13:20', 'אודיטוריום']
  ]);

  dateRule_(sh, 1);
  lenRule_(sh, 3, LIMITS.eventTitle, 'כותרת');
  timeRule_(sh, 4);
  timeRule_(sh, 5);
  lenRule_(sh, 6, LIMITS.eventLocation, 'מקום');
  sh.setColumnWidths(1, headers.length, 130);
  sh.getRange('B1').setNote(
    'שכבה אחת או יותר, מופרדות בפסיק, למשל: ז׳, ח׳\n' +
    'מארבע שכבות ומעלה הלוח מציג "כל השכבות".');
}

function buildMessages_(sh) {
  var headers = ['הודעה', 'סוג', 'קישור', 'מתאריך', 'עד תאריך', 'פעיל'];
  header_(sh, headers);
  sh.getRange(2, 1, 4, headers.length).setValues([
    ['אסיפת הורים ביום שלישי בשעה 19:00', 'רגילה', '', '', '', 'כן'],
    ['מחר: יום כחול-לבן — באים בלבוש חגיגי', 'רגילה', '', '', '', 'כן'],
    ['שיעורי שכבת ז׳ מסתיימים היום ב-13:20', 'דחופה', '', '', '', 'כן'],
    ['ההסעה לקו הדרומי יוצאת ב-14:00 מהשער האחורי', 'דחופה', '', '', '', 'כן']
  ]);

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
  dateRule_(sh, 4);
  dateRule_(sh, 5);
  listRule_(sh, 6, YESNO, 'פעיל');

  sh.setColumnWidth(1, 420);
  sh.setColumnWidth(2, 90);
  sh.setColumnWidth(3, 260);
  sh.setColumnWidths(4, 2, 110);
  sh.setColumnWidth(6, 70);
  sh.getRange('C1').setNote(
    'רק לסוג "וידאו": קישור ישיר לקובץ MP4 (H.264, עד 1080p30).\n' +
    'הסרטון מושתק כברירת מחדל; להוספת סאונד יש לסיים את הקישור ב-#sound');
  sh.getRange('D1').setNote('טווח תאריכים להצגה. ריק = תמיד.');
  sh.getRange('F1').setNote('"לא" מסתיר את ההודעה בלי למחוק אותה.');
  sh.getRange('A1').setNote(NO_PII_NOTE);
}

/* Presentation settings the principal can change without touching code.
   A plain key/value tab, so more settings can be added later without
   changing its shape. */
function buildSettings_(sh) {
  header_(sh, ['הגדרה', 'ערך']);
  sh.getRange(2, 1, 1, 2).setValues([['ערכת נושא', 'כהה']]);

  /* the key column is fixed — protect it from typos */
  var keyRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['ערכת נושא'], true)
    .setAllowInvalid(false)
    .setHelpText('שם ההגדרה')
    .build();
  sh.getRange(2, 1, 50).setDataValidation(keyRule);

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
