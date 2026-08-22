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

var DAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו'];
var TYPES = ['רגילה', 'דחופה', 'וידאו'];
var YESNO = ['כן', 'לא'];

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetLocale('he_IL');
  ss.setSpreadsheetTimeZone('Asia/Jerusalem');

  buildSchedule_(sheet_(ss, 'מערכת'));
  buildExams_(sheet_(ss, 'מבחנים'));
  buildEvents_(sheet_(ss, 'אירועים'));
  buildMessages_(sheet_(ss, 'הודעות'));

  /* drop the default empty sheet if it is still around */
  var extra = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
  if (extra && ss.getSheets().length > 4) ss.deleteSheet(extra);

  SpreadsheetApp.getUi().alert(
    'הגיליון נבנה בהצלחה.\n\n' +
    'השלב הבא: קובץ → שיתוף → פרסום באינטרנט,\n' +
    'ולפרסם כל אחד מארבעת הגיליונות בנפרד כ-CSV.\n' +
    'ראו את ההוראות המלאות בקובץ README.');
}

/* ---------- helpers ---------- */

function sheet_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  sh.clearConditionalFormatRules();
  try { sh.setRightToLeft(true); } catch (e) {}
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
  var headers = ['Day', 'Period', 'Start', 'End'].concat(GRADES);
  header_(sh, headers);

  /* one sample day so the board has something to show immediately */
  var rows = [
    ['א', 1, '08:00', '08:45'],
    ['א', 2, '08:50', '09:35'],
    ['א', 3, '09:50', '10:35']
  ].map(function (r, i) {
    return r.concat(GRADES.map(function (g, gi) {
      return ['מתמטיקה', 'אנגלית', 'לשון'][(i + gi) % 3];
    }));
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
    'כל עמודה אחרי End היא שכבה — הלוח מתאים את עצמו אוטומטית.');
}

function buildExams_(sh) {
  var headers = ['Date', 'Grade', 'Subject', 'Start', 'End', 'Room'];
  header_(sh, headers);
  sh.getRange(2, 1, 1, headers.length).setValues([
    [new Date(), GRADES[2], 'מתמטיקה', '09:00', '10:30', 'חדר 12']
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
}

function buildEvents_(sh) {
  var headers = ['Date', 'Grades', 'Title', 'Start', 'End', 'Location'];
  header_(sh, headers);
  sh.getRange(2, 1, 1, headers.length).setValues([
    [new Date(), GRADES[0] + ', ' + GRADES[1], 'חזרה לטקס', '10:40', '11:25', 'אולם ספורט']
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
  var headers = ['Text', 'Type', 'VideoURL', 'From', 'Until', 'Active'];
  header_(sh, headers);
  sh.getRange(2, 1, 2, headers.length).setValues([
    ['אסיפת הורים ביום שלישי בשעה 19:00', 'רגילה', '', '', '', 'כן'],
    ['שיעורי שכבת ז׳ מסתיימים היום ב-13:20', 'דחופה', '', '', '', 'כן']
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
}
