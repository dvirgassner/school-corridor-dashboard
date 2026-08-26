/* ==================================================================
   sheets-mock.js — enough of the Google Apps Script SpreadsheetApp API
   to RUN sheet-template/setup.gs in Node.

   Why this exists: setup.gs is the one part of the system that can
   destroy a term's work, and the sheet it runs against will soon hold
   the school's real timetable. "I read the code and it looks safe" is
   not a test. This mock lets tests/run.js execute the actual script
   against a sheet full of realistic content and then compare every cell
   before and after, which is a test.

   It models the distinction the whole design rests on: a cell has a
   VALUE, and separately it has formatting, a note, and data validation.
   Setting a background or a dropdown here does not touch the value —
   exactly as in Sheets — so a test that sees a value change has caught
   a real bug, not an artefact of the mock.

   Deliberately not modelled: anything setup.gs never calls. When it
   grows a new call, this file grows with it and the missing-method
   error says so loudly.
   ================================================================== */

'use strict';

const EMPTY = '';

function colToLetter(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = (n - m - 1) / 26;
  }
  return s;
}

function letterToCol(s) {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/* ---------- data validation ---------- */

class DataValidation {
  constructor(spec) { Object.assign(this, spec); }
  getCriteriaType() { return this.type; }
  getCriteriaValues() { return this.values || []; }
  getHelpText() { return this.helpText || ''; }
}

class DataValidationBuilder {
  constructor() { this.spec = { type: null, values: [], allowInvalid: true }; }
  requireFormulaSatisfied(f) {
    this.spec.type = 'CUSTOM_FORMULA'; this.spec.values = [f]; return this;
  }
  requireValueInList(list, showDropdown) {
    this.spec.type = 'VALUE_IN_LIST';
    this.spec.values = [list, showDropdown];
    return this;
  }
  requireCheckbox() { this.spec.type = 'CHECKBOX'; return this; }
  requireDate() { this.spec.type = 'DATE'; return this; }
  setAllowInvalid(v) { this.spec.allowInvalid = v; return this; }
  setHelpText(t) { this.spec.helpText = t; return this; }
  build() { return new DataValidation(this.spec); }
}

/* ---------- conditional formatting ---------- */

class BooleanCondition {
  constructor(formula) { this.formula = formula; }
  getCriteriaValues() { return [this.formula]; }
}

class ConditionalFormatRule {
  constructor(spec) { Object.assign(this, spec); }
  getRanges() { return this.ranges || []; }
  getBooleanCondition() {
    return this.formula ? new BooleanCondition(this.formula) : null;
  }
}

class ConditionalFormatRuleBuilder {
  constructor() { this.spec = {}; }
  whenFormulaSatisfied(f) { this.spec.formula = f; return this; }
  setBackground(c) { this.spec.background = c; return this; }
  setFontColor(c) { this.spec.fontColor = c; return this; }
  setRanges(r) { this.spec.ranges = r; return this; }
  build() { return new ConditionalFormatRule(this.spec); }
}

/* ---------- protection ---------- */

class Protection {
  constructor(range) {
    this.range = range;
    this.description = '';
    this.editors = [];
    this.domainEdit = false;
    this.removed = false;
  }
  setDescription(d) { this.description = d; return this; }
  getDescription() { return this.description; }
  getRange() { return this.range; }
  addEditor(u) {
    if (!this.editors.some((e) => e.getEmail() === u.getEmail())) {
      this.editors.push(u);
    }
    return this;
  }
  getEditors() { return this.editors.slice(); }
  removeEditors(list) {
    const drop = new Set(list.map((u) => u.getEmail()));
    this.editors = this.editors.filter((u) => !drop.has(u.getEmail()));
    return this;
  }
  canDomainEdit() { return this.domainEdit; }
  setDomainEdit(v) { this.domainEdit = v; return this; }
  remove() {
    this.removed = true;
    const list = this.range.sheet.protections;
    const i = list.indexOf(this);
    if (i >= 0) list.splice(i, 1);
  }
}

/* ---------- range ---------- */

class Range {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
    if (row < 1 || col < 1) throw new Error('range out of bounds: row/col < 1');
    if (row + numRows - 1 > sheet.maxRows) {
      throw new Error(
        `range out of bounds: rows ${row}..${row + numRows - 1} ` +
        `exceeds ${sheet.maxRows} on "${sheet.name}"`);
    }
    if (col + numCols - 1 > sheet.maxCols) {
      throw new Error(
        `range out of bounds: cols ${col}..${col + numCols - 1} ` +
        `exceeds ${sheet.maxCols} on "${sheet.name}"`);
    }
  }

  getSheet() { return this.sheet; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.numRows; }
  getNumColumns() { return this.numCols; }
  getLastRow() { return this.row + this.numRows - 1; }
  getLastColumn() { return this.col + this.numCols - 1; }
  getA1Notation() {
    const a = colToLetter(this.col) + this.row;
    if (this.numRows === 1 && this.numCols === 1) return a;
    return a + ':' + colToLetter(this.getLastColumn()) + this.getLastRow();
  }

  /* --- values: the only thing a test cares about preserving --- */
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        line.push(this.sheet.values[this.row - 1 + r][this.col - 1 + c]);
      }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }

  setValues(rows) {
    if (rows.length !== this.numRows || rows[0].length !== this.numCols) {
      throw new Error(
        `setValues shape ${rows.length}x${rows[0].length} != ` +
        `range ${this.numRows}x${this.numCols}`);
    }
    if (this.numRows * this.numCols > 1 && this._isMerged()) {
      throw new Error(
        `cannot setValues across the merged range ${this.getA1Notation()} ` +
        `on "${this.sheet.name}" — break it apart first`);
    }
    this.sheet.writes.push({ a1: this.getA1Notation(), kind: 'setValues' });
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        this.sheet.values[this.row - 1 + r][this.col - 1 + c] = rows[r][c];
      }
    }
    return this;
  }
  setValue(v) {
    this.sheet.writes.push({ a1: this.getA1Notation(), kind: 'setValue' });
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        this.sheet.values[this.row - 1 + r][this.col - 1 + c] = v;
      }
    }
    return this;
  }
  clearContent() {
    this.sheet.writes.push({ a1: this.getA1Notation(), kind: 'clearContent' });
    return this.setValue(EMPTY);
  }
  isBlank() {
    return this.getValues().every((line) =>
      line.every((v) => v === EMPTY || v === null || v === undefined));
  }

  /* --- formatting: reaches the data rows, never reads or writes them --- */
  _stamp(prop, value) {
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        const key = (this.row + r) + ',' + (this.col + c);
        this.sheet.format[prop] = this.sheet.format[prop] || {};
        this.sheet.format[prop][key] = value;
      }
    }
    return this;
  }
  /* Merging is modelled because setup.gs merges the יום column, and the
     rule that makes it worth modelling is the one that bites: Sheets
     refuses to write values across a merged range. If the script ever
     stops breaking the block apart first, this throws in the tests
     instead of failing on the live sheet. */
  merge() {
    this.sheet.merges.push(this.getA1Notation());
    return this;
  }
  breakApart() {
    const a1 = this.getA1Notation();
    this.sheet.merges = this.sheet.merges.filter((m) => !this._covers(m));
    return this;
  }
  _covers(a1) {
    const r = this.sheet.getRange(a1);
    return r.row >= this.row && r.getLastRow() <= this.getLastRow() &&
           r.col >= this.col && r.getLastColumn() <= this.getLastColumn();
  }
  _isMerged() {
    return this.sheet.merges.some((m) => {
      const r = this.sheet.getRange(m);
      return !(r.getLastRow() < this.row || r.row > this.getLastRow() ||
               r.getLastColumn() < this.col || r.col > this.getLastColumn());
    });
  }

  setFontSize(s) { return this._stamp('fontSize', s); }
  setVerticalAlignment(a) { return this._stamp('valign', a); }
  getFontSize() {
    return (this.sheet.format.fontSize || {})[this.row + ',' + this.col];
  }
  getFontColor() {
    return (this.sheet.format.fontColor || {})[this.row + ',' + this.col];
  }
  setBackground(c) { return this._stamp('background', c); }
  setFontColor(c) { return this._stamp('fontColor', c); }
  setFontWeight(w) { return this._stamp('fontWeight', w); }
  setHorizontalAlignment(a) { return this._stamp('align', a); }
  setNumberFormat(f) { return this._stamp('numberFormat', f); }
  setNote(n) { return this._stamp('note', n); }
  setBorder() {
    this.sheet.borders.push(this.getA1Notation());
    return this;
  }
  getBackground() {
    return (this.sheet.format.background || {})[this.row + ',' + this.col];
  }
  getNote() {
    return (this.sheet.format.note || {})[this.row + ',' + this.col];
  }

  /* --- data validation: also a cell property, also not the value --- */
  setDataValidation(rule) { return this._stamp('validation', rule); }
  getDataValidation() {
    return (this.sheet.format.validation || {})[this.row + ',' + this.col] || null;
  }
  clearDataValidations() { return this._stamp('validation', null); }

  protect() {
    const p = new Protection(this);
    this.sheet.protections.push(p);
    return p;
  }
}

/* ---------- sheet ---------- */

class Sheet {
  constructor(name, maxRows, maxCols) {
    this.name = name;
    this.maxRows = maxRows;
    this.maxCols = maxCols;
    this.values = Array.from({ length: maxRows },
                             () => Array(maxCols).fill(EMPTY));
    this.format = {};
    this.merges = [];
    this.borders = [];
    this.protections = [];
    this.condRules = [];
    this.colWidths = {};
    this.frozenRows = 0;
    this.rtl = false;
    this.writes = [];           /* audit log of every content mutation */
  }

  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }

  getLastRow() {
    for (let r = this.maxRows - 1; r >= 0; r--) {
      if (this.values[r].some((v) => v !== EMPTY && v !== null && v !== undefined)) {
        return r + 1;
      }
    }
    return 0;
  }
  getLastColumn() {
    for (let c = this.maxCols - 1; c >= 0; c--) {
      for (let r = 0; r < this.maxRows; r++) {
        const v = this.values[r][c];
        if (v !== EMPTY && v !== null && v !== undefined) return c + 1;
      }
    }
    return 0;
  }

  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = /^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/.exec(a);
      if (!m) throw new Error('mock cannot parse A1 notation: ' + a);
      const c1 = letterToCol(m[1]), r1 = Number(m[2]);
      const c2 = m[3] ? letterToCol(m[3]) : c1;
      const r2 = m[4] ? Number(m[4]) : r1;
      return new Range(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new Range(this, a, b, c === undefined ? 1 : c,
                     d === undefined ? 1 : d);
  }

  /* The destructive methods really destroy here. Making them throw
     instead would be a worse mock: the script wraps each tab in a
     try/catch, so a throwing clear() gets swallowed and the data-loss
     test passes for the wrong reason. Faithful behaviour means the
     before/after diff catches the damage directly, which is the whole
     point of running the script rather than reading it. */
  clear() {
    this.writes.push({ a1: 'ALL', kind: 'clear' });
    this.values = Array.from({ length: this.maxRows },
                             () => Array(this.maxCols).fill(EMPTY));
    return this;
  }
  clearContents() { return this.clear(); }

  clearConditionalFormatRules() { this.condRules = []; return this; }
  getConditionalFormatRules() { return this.condRules.slice(); }
  setConditionalFormatRules(rules) { this.condRules = rules.slice(); return this; }

  getProtections(type) { return this.protections.slice(); }

  setFrozenRows(n) { this.frozenRows = n; return this; }
  setRightToLeft(v) { this.rtl = v; return this; }
  setColumnWidth(col, w) { this.colWidths[col] = w; return this; }
  setColumnWidths(col, n, w) {
    for (let i = 0; i < n; i++) this.colWidths[col + i] = w;
    return this;
  }

  insertRowsAfter(after, n) {
    if (after !== this.maxRows) {
      throw new Error('mock only supports appending rows at the end');
    }
    for (let i = 0; i < n; i++) this.values.push(Array(this.maxCols).fill(EMPTY));
    this.maxRows += n;
    return this;
  }
  insertColumnsAfter(after, n) {
    if (after !== this.maxCols) {
      throw new Error('mock only supports appending columns at the end');
    }
    this.values.forEach((row) => {
      for (let i = 0; i < n; i++) row.push(EMPTY);
    });
    this.maxCols += n;
    return this;
  }
}

/* ---------- spreadsheet ---------- */

class Spreadsheet {
  constructor() {
    this.sheets = [];
    /* what a sheet created from sheets.new actually starts as, and the
       locale that reads 01/09/2026 as the 9th of January */
    this.locale = "en_US";
    this.timeZone = null;
    this.toasts = [];
  }
  addSheet(name, maxRows = 1000, maxCols = 26) {
    const sh = new Sheet(name, maxRows, maxCols);
    this.sheets.push(sh);
    return sh;
  }
  getSheetByName(name) {
    return this.sheets.find((s) => s.name === name) || null;
  }
  getSheets() { return this.sheets.slice(); }
  insertSheet(name) { return this.addSheet(name); }
  deleteSheet(sh) {
    const i = this.sheets.indexOf(sh);
    if (i >= 0) this.sheets.splice(i, 1);
  }
  /* Sheets recognises only the LEGACY code for Hebrew. "he_IL" is
     accepted by the call and then silently ignored — no error, no change.
     Modelling that is the point: it is what made every date in the sheet
     read in American order, and a mock that quietly accepted "he_IL"
     would let the same bug back in unnoticed. */
  setSpreadsheetLocale(l) {
    if (l === "he_IL" || l === "he") return this;
    this.locale = l;
    return this;
  }
  getSpreadsheetLocale() { return this.locale; }
  setSpreadsheetTimeZone(t) { this.timeZone = t; return this; }
  toast(msg, title) { this.toasts.push({ msg, title }); }
}

/* ---------- the globals setup.gs expects ---------- */

function makeEnvironment(ss, opts = {}) {
  const user = { getEmail: () => opts.email || 'dvir@gassner.co.il' };
  const props = new Map();
  const logs = [];

  return {
    ss,
    logs,
    globals: {
      SpreadsheetApp: {
        getActiveSpreadsheet: () => ss,
        getUi: () => { throw new Error('no UI in this context'); },
        newDataValidation: () => new DataValidationBuilder(),
        newConditionalFormatRule: () => new ConditionalFormatRuleBuilder(),
        BorderStyle: { SOLID: 'SOLID', SOLID_THICK: 'SOLID_THICK' },
        ProtectionType: { RANGE: 'RANGE', SHEET: 'SHEET' },
        DataValidationCriteria: {
          CUSTOM_FORMULA: 'CUSTOM_FORMULA',
          VALUE_IN_LIST: 'VALUE_IN_LIST',
          CHECKBOX: 'CHECKBOX'
        }
      },
      Session: { getEffectiveUser: () => user },
      PropertiesService: {
        getDocumentProperties: () => ({
          getProperty: (k) => (props.has(k) ? props.get(k) : null),
          setProperty: (k, v) => { props.set(k, v); }
        })
      },
      Logger: { log: (m) => logs.push(String(m)) },
      console: { error: (m) => logs.push('ERROR ' + m), log: () => {} },
      Utilities: { sleep: () => {} }
    }
  };
}

module.exports = { Spreadsheet, Sheet, Range, makeEnvironment, colToLetter };
