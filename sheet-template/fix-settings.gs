/**
 * fix-settings.gs — repair (or create) the הגדרות tab and its dropdown.
 *
 * Use this when the theme dropdown is missing. It touches ONLY the
 * הגדרות tab, so your schedule, exams, events and messages are safe —
 * unlike re-running setup(), which rebuilds every tab from scratch.
 *
 * How to run: Extensions -> Apps Script, paste this in a new file
 * (or replace the editor contents), Run "fixSettings".
 *
 * It reports what it found and what it changed, so a silent failure
 * cannot happen twice.
 */

function fixSettings() {
  var THEME_VALUES = ['כהה', 'בהירה', 'צבעונית'];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = [];

  /* find the tab, or make it */
  var sh = ss.getSheetByName('הגדרות');
  if (!sh) {
    sh = ss.insertSheet('הגדרות');
    log.push('נוצר גיליון "הגדרות".');
  } else {
    log.push('נמצא גיליון "הגדרות".');
  }
  try { sh.setRightToLeft(true); } catch (e) {}

  /* Apps Script throws if a range runs past the sheet's last row, which
     is easy to hit on a sheet converted from a CSV (those arrive sized
     to the data). Grow it first. */
  var WANT_ROWS = 20;
  if (sh.getMaxRows() < WANT_ROWS) {
    sh.insertRowsAfter(sh.getMaxRows(), WANT_ROWS - sh.getMaxRows());
    log.push('הורחב ל-' + WANT_ROWS + ' שורות.');
  }
  if (sh.getMaxColumns() < 2) {
    sh.insertColumnsAfter(sh.getMaxColumns(), 2 - sh.getMaxColumns());
    log.push('הורחב ל-2 עמודות.');
  }

  /* headers + the one setting we have today */
  sh.getRange('A1:B1').setValues([['הגדרה', 'ערך']])
    .setFontWeight('bold').setBackground('#efefef');
  sh.setFrozenRows(1);
  var current = String(sh.getRange('B2').getValue() || '').trim();
  var keep = THEME_VALUES.indexOf(current) >= 0 ? current : 'כהה';
  sh.getRange('A2:B2').setValues([['ערכת נושא', keep]]);
  log.push('ערכת נושא = ' + keep);

  /* the dropdown itself — clear any stale rule first, then apply */
  var col = sh.getRange(2, 2, WANT_ROWS - 1);
  col.clearDataValidations();
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(THEME_VALUES, true)   /* true = show dropdown */
    .setAllowInvalid(false)
    .setHelpText('ערכת נושא: ' + THEME_VALUES.join(' / '))
    .build();
  col.setDataValidation(rule);

  /* prove it took, rather than trusting that it did */
  var check = sh.getRange('B2').getDataValidation();
  var ok = check && check.getCriteriaValues()[0].join(',') === THEME_VALUES.join(',');
  log.push(ok ? 'התפריט הנפתח הוגדר בהצלחה ✓'
             : 'שגיאה: התפריט לא הוגדר. יש לפנות לאחראי הטכני.');

  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(2, 160);
  sh.getRange('B1').setNote(
    'ערכת נושא של הלוח — בחירה מהתפריט והלוח מתחלף בתוך דקה:\n' +
    '  כהה — רקע שחור (ברירת המחדל; הידידותית ביותר למסך OLED)\n' +
    '  בהירה — רקע לבן, למסדרון מואר\n' +
    '  צבעונית — רקע כחול-כהה עם צבע לכל שכבה');

  /* notify_() lives in setup.gs and never throws, unlike getUi() */
  notify_('הגדרות\n\n' + log.join('\n'));
}
