/* Test harness for the dashboard's pure logic.
   Run:  node tests/run.js
   No framework — Node's built-in assert only, so there is nothing to
   install and nothing to break. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const L = require("../dashboard/logic.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`✗ ${name}\n  ${err.message}`);
    process.exitCode = 1;
  }
}

/* ---------- gematria ---------- */
test("gematria: single letter gets geresh", () => {
  assert.equal(L.toGematria(9), "ט׳");
});
test("gematria: 18 → י״ח", () => {
  assert.equal(L.toGematria(18), "י״ח");
});
test("gematria: 15 → ט״ו (not יה)", () => {
  assert.equal(L.toGematria(15), "ט״ו");
});
test("gematria: 16 → ט״ז (not יו)", () => {
  assert.equal(L.toGematria(16), "ט״ז");
});
test("gematria: 786 → תשפ״ו", () => {
  assert.equal(L.toGematria(786), "תשפ״ו");
});
test("gematria: 30 → ל׳", () => {
  assert.equal(L.toGematria(30), "ל׳");
});

/* ---------- time & dates ---------- */
test("minutes parses HH:MM", () => {
  assert.equal(L.minutes("08:50"), 530);
  assert.equal(L.minutes("00:00"), 0);
  assert.equal(L.minutes("23:59"), 1439);
});
test("dateKey formats local date as YYYY-MM-DD", () => {
  assert.equal(L.dateKey(new Date(2026, 8, 1)), "2026-09-01");
});
test("parseSheetDate accepts ISO", () => {
  assert.equal(L.parseSheetDate("2026-09-01"), "2026-09-01");
});
test("parseSheetDate accepts D/M/YYYY", () => {
  assert.equal(L.parseSheetDate("1/9/2026"), "2026-09-01");
});
test("parseSheetDate accepts DD.MM.YYYY", () => {
  assert.equal(L.parseSheetDate("01.09.2026"), "2026-09-01");
});
test("parseSheetDate rejects garbage", () => {
  assert.equal(L.parseSheetDate("garbage"), null);
  assert.equal(L.parseSheetDate(""), null);
  assert.equal(L.parseSheetDate(undefined), null);
});
test("dayLetter maps weekdays to Hebrew letters", () => {
  assert.equal(L.dayLetter(new Date(2026, 7, 23)), "א"); /* Sunday */
  assert.equal(L.dayLetter(new Date(2026, 7, 24)), "ב");
  assert.equal(L.dayLetter(new Date(2026, 7, 28)), "ו"); /* Friday */
  assert.equal(L.dayLetter(new Date(2026, 7, 22)), "ש"); /* Saturday */
});

/* ---------- timezone / daylight saving ---------- */
test("zonedNow: summer instant → Israel Daylight Time (UTC+3)", () => {
  /* 2026-08-23 22:30 UTC is already 01:30 the next day in Israel */
  const d = L.zonedNow("Asia/Jerusalem", new Date("2026-08-23T22:30:00Z"));
  assert.equal(L.dateKey(d), "2026-08-24");
  assert.equal(d.getHours(), 1);
  assert.equal(d.getMinutes(), 30);
});
test("zonedNow: winter instant → Israel Standard Time (UTC+2)", () => {
  /* same clock time in January is only +2, so still the same date */
  const d = L.zonedNow("Asia/Jerusalem", new Date("2026-01-15T22:30:00Z"));
  assert.equal(L.dateKey(d), "2026-01-16");
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 30);
});
test("zonedNow: DST switch is handled by the tz database, not by us", () => {
  /* 08:00 UTC in winter is 10:00 in Israel; in summer it is 11:00 */
  const w = L.zonedNow("Asia/Jerusalem", new Date("2026-01-15T08:00:00Z"));
  const s = L.zonedNow("Asia/Jerusalem", new Date("2026-07-15T08:00:00Z"));
  assert.equal(w.getHours(), 10);
  assert.equal(s.getHours(), 11);
});
test("zonedNow: day-of-week follows the zone, not UTC", () => {
  /* Saturday 23:00 UTC is already Sunday in Israel — a school day */
  const d = L.zonedNow("Asia/Jerusalem", new Date("2026-08-22T22:00:00Z"));
  assert.equal(L.dayLetter(d), "א");
});
test("zonedNow: unknown zone falls back to machine local time", () => {
  const base = new Date("2026-08-23T10:00:00Z");
  assert.equal(L.zonedNow("Not/AZone", base).getTime(), base.getTime());
});
test("zonedNow: no zone configured returns the instant unchanged", () => {
  const base = new Date("2026-08-23T10:00:00Z");
  assert.equal(L.zonedNow(null, base).getTime(), base.getTime());
});

/* ---------- sheet field semantics ---------- */
test("inRange: empty bounds always in range", () => {
  assert.ok(L.inRange("", "", "2026-09-01"));
});
test("inRange: inside explicit range", () => {
  assert.ok(L.inRange("2026-08-30", "2026-09-02", "2026-09-01"));
});
test("inRange: before start is out", () => {
  assert.ok(!L.inRange("2026-09-02", "", "2026-09-01"));
});
test("inRange: after end is out", () => {
  assert.ok(!L.inRange("", "2026-08-31", "2026-09-01"));
});
test("inRange: bounds are inclusive", () => {
  assert.ok(L.inRange("2026-09-01", "2026-09-01", "2026-09-01"));
});
test("isActive accepts Hebrew and English", () => {
  assert.ok(L.isActive("כן"));
  assert.ok(L.isActive("yes"));
  assert.ok(!L.isActive("לא"));
  assert.ok(!L.isActive("no"));
  assert.ok(!L.isActive(""));
});
test("normalizeType maps Hebrew type names", () => {
  assert.equal(L.normalizeType("רגילה"), "normal");
  assert.equal(L.normalizeType("דחופה"), "urgent");
  assert.equal(L.normalizeType("וידאו"), "video");
});
test("normalizeType maps English type names", () => {
  assert.equal(L.normalizeType("normal"), "normal");
  assert.equal(L.normalizeType("urgent"), "urgent");
  assert.equal(L.normalizeType("video"), "video");
});
test("normalizeType rejects unknown", () => {
  assert.equal(L.normalizeType("blah"), null);
  assert.equal(L.normalizeType(""), null);
});
test("esc escapes HTML metacharacters", () => {
  assert.equal(L.esc("<b>&</b>"), "&lt;b&gt;&amp;&lt;/b&gt;");
  assert.equal(L.esc("מתמטיקה"), "מתמטיקה");
});

/* The sheet's time columns are real time values now, and a CSV export
   carries whatever they are FORMATTED as. hh:mm is what the script sets,
   but these guard the board against a sheet left on another time format
   rather than letting it drop every lesson silently. */
test("minutes: seconds in the string are ignored", () => {
  assert.equal(L.minutes("08:50:00"), 530);
});
test("minutes: 12-hour times resolve correctly", () => {
  assert.equal(L.minutes("1:20 PM"), 800);
  assert.equal(L.minutes("12:30 AM"), 30);
  assert.equal(L.minutes("12:30 PM"), 750);
  assert.equal(L.minutes("8:50 AM"), 530);
});
test("validTime accepts the formats a sheet might export", () => {
  ["08:50", "8:50", "08:50:00", "1:20 PM", "12:30 am"].forEach((s) =>
    assert.ok(L.validTime(s), s + " should be accepted"));
});
test("validTime still rejects what is not a time", () => {
  ["", "מתמטיקה", "0.368055", "850", "8", "8:5:", "nope"].forEach((s) =>
    assert.ok(!L.validTime(s), s + " should be rejected"));
});

/* ---------- buildSchedule ---------- */
const SCHED_FIELDS = ["Day", "Period", "Start", "End", "ז׳", "ח׳"];
const SCHED_ROWS = [
  { Day: "א", Period: "1", Start: "08:00", End: "08:45", "ז׳": "מתמטיקה", "ח׳": "אנגלית" },
  { Day: "א", Period: "2", Start: "08:50", End: "09:35", "ז׳": "לשון", "ח׳": "" },
  { Day: "ב", Period: "1", Start: "08:00", End: "08:45", "ז׳": "כימיה", "ח׳": "ספרות" },
];

test("buildSchedule: grades come from header columns after End", () => {
  const s = L.buildSchedule(SCHED_ROWS, SCHED_FIELDS);
  assert.deepEqual(s.grades, ["ז׳", "ח׳"]);
});
test("buildSchedule: groups periods by day letter", () => {
  const s = L.buildSchedule(SCHED_ROWS, SCHED_FIELDS);
  assert.equal(s.byDay["א"].length, 2);
  assert.equal(s.byDay["ב"].length, 1);
  assert.equal(s.byDay["א"][0].subjects["ז׳"], "מתמטיקה");
  assert.equal(s.byDay["א"][1].subjects["ח׳"], "");
});
/* The יום column is one merged cell per day, and Sheets exports a merged
   cell as its value on the first row and blanks below. These four tests
   are the contract between that sheet layout and the board. */
test("buildSchedule: a blank day means the day above (merged cell)", () => {
  const rows = [
    { Day: "א", Period: "1", Start: "08:00", End: "08:45", "ז׳": "מתמטיקה", "ח׳": "" },
    { Day: "",  Period: "2", Start: "08:50", End: "09:35", "ז׳": "לשון", "ח׳": "" },
    { Day: "",  Period: "3", Start: "09:50", End: "10:35", "ז׳": "אנגלית", "ח׳": "" },
    { Day: "ב", Period: "1", Start: "08:00", End: "08:45", "ז׳": "כימיה", "ח׳": "" },
    { Day: "",  Period: "2", Start: "08:50", End: "09:35", "ז׳": "ספרות", "ח׳": "" },
  ];
  const s = L.buildSchedule(rows, SCHED_FIELDS);
  assert.equal(s.byDay["א"].length, 3, "sunday lost its merged rows");
  assert.equal(s.byDay["ב"].length, 2, "monday lost its merged rows");
  assert.equal(s.byDay["א"][2].subjects["ז׳"], "אנגלית");
});
test("buildSchedule: the repeated-letter shape still works", () => {
  const s = L.buildSchedule(SCHED_ROWS, SCHED_FIELDS);
  assert.equal(s.byDay["א"].length, 2);
  assert.equal(s.byDay["ב"].length, 1);
});
test("buildSchedule: blank rows before any day are not invented into one", () => {
  const rows = [
    { Day: "", Period: "1", Start: "08:00", End: "08:45", "ז׳": "x", "ח׳": "" },
    { Day: "א", Period: "2", Start: "08:50", End: "09:35", "ז׳": "y", "ח׳": "" },
  ];
  const s = L.buildSchedule(rows, SCHED_FIELDS);
  assert.equal(Object.keys(s.byDay).length, 1);
  assert.equal(s.byDay["א"].length, 1);
});

/* ---------- buildSchedule: rooms, and concurrent classes ----------
   The sheet now gives every grade TWO columns — subject and room — and
   says "these classes run at the same time" by INSERTING a row under the
   lesson. An inserted row cannot carry a day, a period or a time,
   because those four columns are locked, so it arrives holding nothing
   but the extra group's subject and room. Every test below is a shape
   the real sheet produces. */
const ROOM_FIELDS = ["יום", "שיעור", "התחלה", "סיום",
                     "ז׳", "ז׳ חדר", "ח׳", "ח׳ חדר"];
/* one CSV row of that sheet, with only the named cells filled */
const R = (day, period, start, end, cells) =>
  Object.assign({ "יום": day, "שיעור": period, "התחלה": start, "סיום": end,
                  "ז׳": "", "ז׳ חדר": "", "ח׳": "", "ח׳ חדר": "" }, cells);

test("buildSchedule: a room column is not mistaken for a grade", () => {
  const s = L.buildSchedule(
    [R("א", "1", "08:15", "09:00", { "ז׳": "מתמטיקה", "ז׳ חדר": "חדר 12" })],
    ROOM_FIELDS);
  assert.deepEqual(s.grades, ["ז׳", "ח׳"],
    "the room columns leaked into the grade list — the board would draw " +
    "a card for each of them");
});

test("buildSchedule: a lesson carries the room beside it", () => {
  const s = L.buildSchedule([R("א", "1", "08:15", "09:00", {
    "ז׳": "מתמטיקה", "ז׳ חדר": "חדר 12", "ח׳": "אנגלית", "ח׳ חדר": "מעבדה"
  })], ROOM_FIELDS);
  const p = s.byDay["א"][0];
  assert.equal(p.subjects["ז׳"], "מתמטיקה");
  assert.equal(p.rooms["ז׳"], "חדר 12");
  assert.deepEqual(p.entries["ז׳"], [{ subject: "מתמטיקה", room: "חדר 12" }]);
  assert.deepEqual(p.entries["ח׳"], [{ subject: "אנגלית", room: "מעבדה" }]);
});

test("buildSchedule: an inserted row is another class in the SAME slot", () => {
  const s = L.buildSchedule([
    R("א", "1", "08:15", "09:00", { "ז׳": "אנגלית — קבוצה א", "ז׳ חדר": "חדר 4" }),
    R("",  "",  "",      "",      { "ז׳": "אנגלית — קבוצה ב", "ז׳ חדר": "חדר 9" }),
    R("",  "2", "09:00", "09:45", { "ז׳": "מתמטיקה", "ז׳ חדר": "חדר 12" })
  ], ROOM_FIELDS);
  assert.equal(s.byDay["א"].length, 2,
    "the split row was counted as a period of its own");
  const p = s.byDay["א"][0];
  assert.equal(p.entries["ז׳"].length, 2, "the second group was lost");
  assert.deepEqual(p.entries["ז׳"][1],
    { subject: "אנגלית — קבוצה ב", room: "חדר 9" });
  assert.equal(p.start, "08:15", "the slot kept its own start time");
  assert.equal(p.end, "09:00");
  assert.equal(p.period, "1", "the slot kept the period number of its first row");
  assert.equal(s.byDay["א"][1].entries["ז׳"].length, 1,
    "the split leaked into the following period");
});

test("buildSchedule: four concurrent classes in one period", () => {
  const s = L.buildSchedule([
    R("א", "6", "12:45", "13:30", { "ח׳": "פיזיקה", "ח׳ חדר": "מעבדה" }),
    R("",  "",  "",      "",      { "ח׳": "כימיה", "ח׳ חדר": "מעבדת כימיה" }),
    R("",  "",  "",      "",      { "ח׳": "ביולוגיה", "ח׳ חדר": "חדר 3" }),
    R("",  "",  "",      "",      { "ח׳": "מחשבים", "ח׳ חדר": "חדר מחשבים" })
  ], ROOM_FIELDS);
  assert.equal(s.byDay["א"].length, 1);
  const p = s.byDay["א"][0];
  assert.deepEqual(p.entries["ח׳"].map((e) => e.subject),
    ["פיזיקה", "כימיה", "ביולוגיה", "מחשבים"]);
  assert.deepEqual(p.entries["ח׳"].map((e) => e.room),
    ["מעבדה", "מעבדת כימיה", "חדר 3", "חדר מחשבים"]);
  assert.deepEqual(p.entries["ז׳"], [], "a grade with no class has no entries");
});

test("buildSchedule: the single-subject view still answers for app.js", () => {
  /* app.js renders one line per grade per period and reads subjects[g]
     as a plain string. Until that pane is redesigned, a split period
     must present its FIRST class there — not an object, not a list. */
  const s = L.buildSchedule([
    R("א", "1", "08:15", "09:00", { "ז׳": "אנגלית — קבוצה א", "ז׳ חדר": "חדר 4" }),
    R("",  "",  "",      "",      { "ז׳": "אנגלית — קבוצה ב", "ז׳ חדר": "חדר 9" })
  ], ROOM_FIELDS);
  const p = s.byDay["א"][0];
  assert.equal(typeof p.subjects["ז׳"], "string");
  assert.equal(p.subjects["ז׳"], "אנגלית — קבוצה א");
  assert.equal(p.rooms["ז׳"], "חדר 4");
  assert.equal(p.subjects["ח׳"], "", "a grade with no class must be falsy");
});

test("buildSchedule: a split for one grade leaves the others alone", () => {
  const s = L.buildSchedule([
    R("א", "1", "08:15", "09:00", { "ז׳": "אנגלית", "ח׳": "מתמטיקה" }),
    R("",  "",  "",      "",      { "ז׳": "אנגלית — קבוצה ב" })
  ], ROOM_FIELDS);
  const p = s.byDay["א"][0];
  assert.equal(p.entries["ז׳"].length, 2);
  assert.equal(p.entries["ח׳"].length, 1, "ח׳ gained a class it does not have");
  assert.equal(p.subjects["ח׳"], "מתמטיקה");
});

test("buildSchedule: an empty row under a lesson adds nothing", () => {
  const s = L.buildSchedule([
    R("א", "1", "08:15", "09:00", { "ז׳": "אנגלית" }),
    R("",  "",  "",      "",      {}),
    R("",  "2", "09:00", "09:45", { "ז׳": "מתמטיקה" })
  ], ROOM_FIELDS);
  assert.equal(s.byDay["א"].length, 2);
  assert.equal(s.byDay["א"][0].entries["ז׳"].length, 1,
    "a blank spacing row became a silent extra class");
});

test("buildSchedule: a split row works on a sheet that repeats the day", () => {
  /* the same insertion in a sheet whose יום column was typed by hand
     rather than merged: the day IS stated, the times still are not */
  const s = L.buildSchedule([
    R("א", "1", "08:15", "09:00", { "ז׳": "אנגלית" }),
    R("א", "",  "",      "",      { "ז׳": "אנגלית — קבוצה ב" })
  ], ROOM_FIELDS);
  assert.equal(s.byDay["א"].length, 1);
  assert.equal(s.byDay["א"][0].entries["ז׳"].length, 2);
});

test("buildSchedule: a sheet with no room columns still parses", () => {
  /* the shape before rooms existed — it must keep working, because the
     board is deployed before the sheet is rebuilt */
  const s = L.buildSchedule(SCHED_ROWS, SCHED_FIELDS);
  const p = s.byDay["א"][0];
  assert.deepEqual(s.grades, ["ז׳", "ח׳"]);
  assert.equal(p.subjects["ז׳"], "מתמטיקה");
  assert.equal(p.rooms["ז׳"], "", "there is no room column to read");
  assert.deepEqual(p.entries["ז׳"], [{ subject: "מתמטיקה", room: "" }]);
  assert.deepEqual(p.entries["ח׳"], [{ subject: "אנגלית", room: "" }]);
});
test("buildSchedule: a skipped bad-time row still carries its day on", () => {
  const rows = [
    { Day: "א", Period: "1", Start: "nope", End: "08:45", "ז׳": "x", "ח׳": "" },
    { Day: "",  Period: "2", Start: "08:50", End: "09:35", "ז׳": "y", "ח׳": "" },
  ];
  const s = L.buildSchedule(rows, SCHED_FIELDS);
  assert.equal(s.byDay["א"].length, 1, "the day was lost with the bad row");
});

test("buildSchedule: skips rows with missing or bad times", () => {
  const rows = SCHED_ROWS.concat([
    { Day: "א", Period: "9", Start: "", End: "10:00", "ז׳": "x", "ח׳": "" },
    { Day: "א", Period: "9", Start: "nope", End: "10:00", "ז׳": "x", "ח׳": "" },
  ]);
  const s = L.buildSchedule(rows, SCHED_FIELDS);
  assert.equal(s.byDay["א"].length, 2);
});
test("buildSchedule: sorts periods by start time", () => {
  const rows = [SCHED_ROWS[1], SCHED_ROWS[0]];
  const s = L.buildSchedule(rows, SCHED_FIELDS);
  assert.equal(s.byDay["א"][0].start, "08:00");
});
test("buildSchedule: tolerates empty input", () => {
  const s = L.buildSchedule([], SCHED_FIELDS);
  assert.deepEqual(s.grades, ["ז׳", "ח׳"]);
  assert.deepEqual(s.byDay, {});
});

/* ---------- buildAgenda ---------- */
const TODAY = "2026-09-01";
test("buildAgenda: merges exams and events sorted by start", () => {
  const exams = [
    { Date: TODAY, Grade: "ט׳", Subject: "מתמטיקה", Start: "12:00", End: "13:00", Room: "חדר 12" },
  ];
  const events = [
    { Date: TODAY, Grades: "ז׳, ח׳", Title: "טקס", Start: "09:00", End: "10:00", Location: "אולם" },
  ];
  const a = L.buildAgenda(exams, events, TODAY);
  assert.equal(a.length, 2);
  assert.equal(a[0].kind, "event");
  assert.deepEqual(a[0].grades, ["ז׳", "ח׳"]);
  assert.equal(a[0].room, "אולם");           /* Location → room */
  assert.equal(a[1].kind, "exam");
  assert.equal(a[1].subject, "מתמטיקה");     /* bare subject, no prefix */
});
test("buildAgenda: filters to today only", () => {
  const exams = [
    { Date: TODAY, Grade: "ט׳", Subject: "א", Start: "09:00", End: "10:00", Room: "ר" },
    { Date: "2026-09-02", Grade: "ט׳", Subject: "ב", Start: "09:00", End: "10:00", Room: "ר" },
  ];
  assert.equal(L.buildAgenda(exams, [], TODAY).length, 1);
});
test("buildAgenda: skips malformed rows", () => {
  const exams = [
    { Date: "junk", Grade: "ט׳", Subject: "א", Start: "09:00", End: "10:00", Room: "ר" },
    { Date: TODAY, Grade: "ט׳", Subject: "", Start: "09:00", End: "10:00", Room: "ר" },
  ];
  const events = [
    { Date: TODAY, Grades: "ז׳", Title: "טקס", Start: "", End: "10:00", Location: "אולם" },
  ];
  assert.equal(L.buildAgenda(exams, events, TODAY).length, 0);
});
test("buildAgenda: accepts DD/MM/YYYY dates from Sheets", () => {
  const exams = [
    { Date: "1/9/2026", Grade: "ט׳", Subject: "א", Start: "09:00", End: "10:00", Room: "ר" },
  ];
  assert.equal(L.buildAgenda(exams, [], TODAY).length, 1);
});

/* ---------- events: a checkbox column per grade ---------- */
const EGRADES = ["ז׳", "ח׳", "ט׳", "י׳"];

test("isChecked: accepts TRUE and hand-typed equivalents", () => {
  assert.ok(L.isChecked("TRUE") && L.isChecked("true"));
  assert.ok(L.isChecked("כן") && L.isChecked("✓") && L.isChecked("1"));
  assert.ok(!L.isChecked("FALSE") && !L.isChecked("") && !L.isChecked(undefined));
});
test("buildAgenda: ticked checkbox columns become the event's grades", () => {
  const events = [{
    "תאריך": TODAY, "כותרת": "טקס", "התחלה": "09:00", "סיום": "10:00",
    "מקום": "אולם",
    "ז׳": "TRUE", "ח׳": "FALSE", "ט׳": "TRUE", "י׳": "FALSE"
  }];
  const a = L.buildAgenda([], events, TODAY, EGRADES);
  assert.deepEqual(a[0].grades, ["ז׳", "ט׳"]);
});
test("buildAgenda: grade order follows the schedule, not the sheet", () => {
  const events = [{
    "תאריך": TODAY, "כותרת": "טקס", "התחלה": "09:00", "סיום": "10:00",
    "י׳": "TRUE", "ז׳": "TRUE"
  }];
  const a = L.buildAgenda([], events, TODAY, EGRADES);
  assert.deepEqual(a[0].grades, ["ז׳", "י׳"]);
});
test("buildAgenda: no boxes ticked leaves an event with no grades", () => {
  const events = [{
    "תאריך": TODAY, "כותרת": "טקס", "התחלה": "09:00", "סיום": "10:00",
    "ז׳": "FALSE"
  }];
  const a = L.buildAgenda([], events, TODAY, EGRADES);
  assert.equal(a.length, 1);            /* still shown — it is an event */
  assert.deepEqual(a[0].grades, []);
});
test("buildAgenda: the כולם checkbox marks an event for the whole school", () => {
  const events = [{
    "תאריך": TODAY, "כותרת": "עצרת", "התחלה": "08:00", "סיום": "08:45",
    "ז׳": "FALSE", "כולם": "TRUE"
  }];
  const a = L.buildAgenda([], events, TODAY, EGRADES);
  assert.equal(a[0].all, true);
  assert.deepEqual(a[0].grades, []);
});
test("buildAgenda: כולם unticked leaves all=false", () => {
  const events = [{
    "תאריך": TODAY, "כותרת": "טקס", "התחלה": "09:00", "סיום": "10:00",
    "ז׳": "TRUE", "כולם": "FALSE"
  }];
  const a = L.buildAgenda([], events, TODAY, EGRADES);
  assert.equal(a[0].all, false);
  assert.deepEqual(a[0].grades, ["ז׳"]);
});
test("buildAgenda: כולם typed into the legacy שכבות cell also counts", () => {
  const events = [{
    "תאריך": TODAY, "שכבות": "כולם", "כותרת": "עצרת",
    "התחלה": "08:00", "סיום": "08:45"
  }];
  const a = L.buildAgenda([], events, TODAY, EGRADES);
  assert.equal(a[0].all, true);
  assert.deepEqual(a[0].grades, []);   /* not treated as a grade name */
});
test("buildAgenda: old comma-separated שכבות column still works", () => {
  const events = [{
    "תאריך": TODAY, "שכבות": "ז׳, ט׳", "כותרת": "טקס",
    "התחלה": "09:00", "סיום": "10:00", "מקום": "אולם"
  }];
  const a = L.buildAgenda([], events, TODAY, EGRADES);
  assert.deepEqual(a[0].grades, ["ז׳", "ט׳"]);
});
test("buildAgenda: checkboxes win over a stale שכבות cell", () => {
  const events = [{
    "תאריך": TODAY, "שכבות": "ח׳", "כותרת": "טקס",
    "התחלה": "09:00", "סיום": "10:00", "ז׳": "TRUE"
  }];
  const a = L.buildAgenda([], events, TODAY, EGRADES);
  assert.deepEqual(a[0].grades, ["ז׳"]);
});

/* ---------- buildMessages ---------- */
test("buildMessages: splits by type, honors Active and range", () => {
  const rows = [
    { Text: "רגילה כאן", Type: "רגילה", VideoURL: "", From: "", Until: "", Active: "כן" },
    { Text: "דחוף כאן", Type: "דחופה", VideoURL: "", From: "", Until: "", Active: "כן" },
    { Text: "כבוי", Type: "רגילה", VideoURL: "", From: "", Until: "", Active: "לא" },
    { Text: "עבר", Type: "רגילה", VideoURL: "", From: "", Until: "2026-08-31", Active: "כן" },
  ];
  const m = L.buildMessages(rows, TODAY);
  assert.deepEqual(m.normal, ["רגילה כאן"]);
  assert.deepEqual(m.urgent, ["דחוף כאן"]);
});
test("buildMessages: a sheet with no פעיל column still shows messages", () => {
  /* the columns are optional; absent must never mean hidden */
  const rows = [
    { "הודעה": "שלום", "סוג": "רגילה", "סאונד": "לא" },
    { "הודעה": "דחוף", "סוג": "דחופה", "סאונד": "לא" }
  ];
  const m = L.buildMessages(rows, TODAY);
  assert.deepEqual(m.normal, ["שלום"]);
  assert.deepEqual(m.urgent, ["דחוף"]);
});
test("buildMessages: סאונד is ignored on non-video messages", () => {
  const rows = [
    { "הודעה": "שלום", "סוג": "רגילה", "סאונד": "כן" },
    { "הודעה": "דחוף", "סוג": "דחופה", "סאונד": "כן" }
  ];
  const m = L.buildMessages(rows, TODAY);
  assert.deepEqual(m.normal, ["שלום"]);
  assert.deepEqual(m.urgent, ["דחוף"]);
  assert.deepEqual(m.videos, []);        /* no phantom video row */
});
test("buildMessages: an explicit לא still hides a row", () => {
  const rows = [{ "הודעה": "כבוי", "סוג": "רגילה", "פעיל": "לא" }];
  assert.deepEqual(L.buildMessages(rows, TODAY).normal, []);
});
test("buildMessages: video rows carry src and sound flag", () => {
  const rows = [
    { Text: "", Type: "וידאו", VideoURL: "https://x/y.mp4#sound", From: "", Until: "", Active: "כן" },
    { Text: "", Type: "וידאו", VideoURL: "https://x/z.mp4", From: "", Until: "", Active: "כן" },
  ];
  const m = L.buildMessages(rows, TODAY);
  assert.deepEqual(m.videos, [
    { kind: "file", src: "https://x/y.mp4", sound: true },
    { kind: "file", src: "https://x/z.mp4", sound: false },
  ]);
});

/* ---------- video link normalisation ---------- */
test("normalizeVideo: direct media file link passes through", () => {
  assert.deepEqual(L.normalizeVideo("https://x/a.mp4"),
    { kind: "file", src: "https://x/a.mp4", sound: false });
});
test("normalizeVideo: sound comes from the sheet column", () => {
  assert.equal(L.normalizeVideo("https://x/a.mp4", true).sound, true);
  assert.equal(L.normalizeVideo("https://x/a.mp4", false).sound, false);
  assert.equal(L.normalizeVideo("https://youtu.be/abc123XYZ", true).sound, true);
});
test("normalizeVideo: legacy #sound suffix still works and is stripped", () => {
  const v = L.normalizeVideo("https://x/a.mp4#sound");
  assert.equal(v.sound, true);
  assert.equal(v.src, "https://x/a.mp4");
});
test("normalizeVideo: a web page or Drive folder is rejected", () => {
  /* the principal only has Drive/YouTube links, so anything else here
     is a mistake — better skipped than handed to a <video> element */
  assert.equal(L.normalizeVideo("https://example.com/some/page"), null);
  assert.equal(L.normalizeVideo("https://drive.google.com/drive/folders/1AbCdEfGhIj"), null);
});
test("normalizeVideo: YouTube watch link", () => {
  const v = L.normalizeVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(v.kind, "youtube");
  assert.equal(v.id, "dQw4w9WgXcQ");
});
test("normalizeVideo: YouTube watch link with extra params", () => {
  const v = L.normalizeVideo("https://www.youtube.com/watch?list=PL123&v=abc123XYZ&t=30s");
  assert.equal(v.id, "abc123XYZ");
});
test("normalizeVideo: youtu.be short link", () => {
  assert.equal(L.normalizeVideo("https://youtu.be/abc123XYZ?t=5").id, "abc123XYZ");
});
test("normalizeVideo: YouTube shorts and embed links", () => {
  assert.equal(L.normalizeVideo("https://youtube.com/shorts/abc123XYZ").id, "abc123XYZ");
  assert.equal(L.normalizeVideo("https://www.youtube.com/embed/abc123XYZ").id, "abc123XYZ");
});
test("normalizeVideo: YouTube keeps the sound flag", () => {
  assert.equal(L.normalizeVideo("https://youtu.be/abc123XYZ#sound").sound, true);
});
test("normalizeVideo: Drive share link becomes a direct-download link", () => {
  const v = L.normalizeVideo(
    "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing");
  assert.equal(v.kind, "file");
  assert.equal(v.drive, true);
  assert.equal(v.src,
    "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp");
});
test("normalizeVideo: older Drive open?id= form", () => {
  const v = L.normalizeVideo("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp");
  assert.equal(v.src,
    "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp");
});
test("normalizeVideo: an already-direct Drive link is left usable", () => {
  const v = L.normalizeVideo(
    "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp");
  assert.equal(v.src,
    "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMnOp");
});
test("normalizeVideo: rubbish and non-URLs are rejected", () => {
  assert.equal(L.normalizeVideo(""), null);
  assert.equal(L.normalizeVideo("   "), null);
  assert.equal(L.normalizeVideo("שלום"), null);
  assert.equal(L.normalizeVideo("drive.google.com/file/d/x"), null); /* no scheme */
});
test("normalizeVideo: a Drive viewer page is never handed to <video>", () => {
  /* the whole point: a share link points at a page, not a media file */
  const v = L.normalizeVideo("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view");
  assert.ok(!v.src.includes("/view"));
});
test("buildMessages: skips unknown type, empty text, empty video url", () => {
  const rows = [
    { Text: "x", Type: "מה?", VideoURL: "", From: "", Until: "", Active: "כן" },
    { Text: "", Type: "רגילה", VideoURL: "", From: "", Until: "", Active: "כן" },
    { Text: "", Type: "וידאו", VideoURL: "", From: "", Until: "", Active: "כן" },
  ];
  const m = L.buildMessages(rows, TODAY);
  assert.deepEqual(m, { normal: [], urgent: [], videos: [] });
});

/* ---------- Hebrew column headers (what the real sheet uses) ---------- */
test("buildSchedule: reads Hebrew headers", () => {
  const fields = ["יום", "שיעור", "התחלה", "סיום", "ז׳", "ח׳"];
  const rows = [
    { "יום": "א", "שיעור": "1", "התחלה": "08:00", "סיום": "08:45", "ז׳": "מתמטיקה", "ח׳": "אנגלית" },
  ];
  const s = L.buildSchedule(rows, fields);
  assert.deepEqual(s.grades, ["ז׳", "ח׳"]);
  assert.equal(s.byDay["א"][0].subjects["ז׳"], "מתמטיקה");
  assert.equal(s.byDay["א"][0].start, "08:00");
});
test("buildAgenda: reads Hebrew headers for exams and events", () => {
  const exams = [
    { "תאריך": TODAY, "שכבה": "ט׳", "מקצוע": "מתמטיקה", "התחלה": "12:00", "סיום": "13:00", "חדר": "חדר 12" },
  ];
  const events = [
    { "תאריך": TODAY, "שכבות": "ז׳, ח׳", "כותרת": "טקס", "התחלה": "09:00", "סיום": "10:00", "מקום": "אולם" },
  ];
  const a = L.buildAgenda(exams, events, TODAY);
  assert.equal(a.length, 2);
  assert.equal(a[0].kind, "event");
  assert.equal(a[0].title, "טקס");
  assert.equal(a[0].room, "אולם");
  assert.deepEqual(a[0].grades, ["ז׳", "ח׳"]);
  assert.equal(a[1].subject, "מתמטיקה");
  assert.equal(a[1].room, "חדר 12");
});
test("buildMessages: reads Hebrew headers", () => {
  const LINK = "קישור לוידאו (Google Drive או YouTube)";
  const rows = [
    { "הודעה": "שלום", "סוג": "רגילה", [LINK]: "", "מתאריך": "", "עד תאריך": "", "פעיל": "כן" },
    { "הודעה": "דחוף", "סוג": "דחופה", [LINK]: "", "מתאריך": "", "עד תאריך": "", "פעיל": "כן" },
    { "הודעה": "", "סוג": "וידאו", [LINK]: "https://x/y.mp4#sound", "מתאריך": "", "עד תאריך": "", "פעיל": "כן" },
    { "הודעה": "כבוי", "סוג": "רגילה", [LINK]: "", "מתאריך": "", "עד תאריך": "", "פעיל": "לא" },
  ];
  const m = L.buildMessages(rows, TODAY);
  assert.deepEqual(m.normal, ["שלום"]);
  assert.deepEqual(m.urgent, ["דחוף"]);
  assert.deepEqual(m.videos,
    [{ kind: "file", src: "https://x/y.mp4", sound: true }]);
});

/* ---------- parseSheetFragment ----------
   The sheet token lives only on the Pi, passed in the URL fragment, so
   it never appears in the public repository. */
const TOKEN = "2PACX-1vTb27gT7Isq5AIGSthUQ_abc-XYZ";

test("parseSheetFragment: builds four CSV URLs in tab order", () => {
  const s = L.parseSheetFragment(`#t=${TOKEN}&g=0,111,222,333`);
  assert.ok(s);
  assert.ok(s.schedule.includes(`/d/e/${TOKEN}/pub?gid=0&`));
  assert.ok(s.exams.includes("gid=111&"));
  assert.ok(s.events.includes("gid=222&"));
  assert.ok(s.messages.includes("gid=333&"));
  assert.ok(s.schedule.endsWith("single=true&output=csv"));
});
test("parseSheetFragment: works without the leading #", () => {
  assert.ok(L.parseSheetFragment(`t=${TOKEN}&g=0,1,2,3`));
});
test("parseSheetFragment: no fragment → null (falls back to demo)", () => {
  assert.equal(L.parseSheetFragment(""), null);
  assert.equal(L.parseSheetFragment("#"), null);
  assert.equal(L.parseSheetFragment(null), null);
});
test("parseSheetFragment: missing token or gids → null", () => {
  assert.equal(L.parseSheetFragment("#g=0,1,2,3"), null);
  assert.equal(L.parseSheetFragment(`#t=${TOKEN}`), null);
});
test("parseSheetFragment: wrong number of gids → null", () => {
  /* 4 tabs, 5 with the settings tab, 6 with ימים ללא לימודים; anything
     outside that range is a typo */
  assert.equal(L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2`), null);
  assert.equal(L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2,3,4,5,6`), null);
});
test("parseSheetFragment: a 6th gid becomes the closures tab", () => {
  const f6 = L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2,3,4,5`);
  assert.ok(f6 && f6.closures, "the 6th gid was not read");
  assert.ok(/gid=5/.test(f6.closures), "the closures URL used the wrong gid");
  /* older kiosk URLs must keep working, without a closures URL */
  const f4 = L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2,3`);
  assert.ok(f4 && !f4.closures, "a 4-gid URL should carry no closures tab");
  const f5 = L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2,3,4`);
  assert.ok(f5 && f5.settings && !f5.closures);
});
test("parseSheetFragment: config can supply a gid the kiosk URL lacks", () => {
  /* The board on the wall was deployed before the closures tab existed,
     and its URL cannot be changed without restarting the kiosk session in
     a school nobody can visit today. So config.js may name the tab, and
     the document id keeps coming from the fragment. */
  const f5 = L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2,3,4`,
                                  { closures: "304029529" });
  assert.ok(f5.closures && /gid=304029529/.test(f5.closures),
    "config gid was not used to build the closures URL");
  assert.ok(f5.closures.indexOf(TOKEN) >= 0,
    "the closures URL must be built from the fragment's own sheet");

  /* A gid in the URL always wins over the one in config. */
  const f6 = L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2,3,4,5`,
                                  { closures: "304029529" });
  assert.ok(/gid=5/.test(f6.closures), "the URL's own 6th gid should win");

  /* Junk in config must not reach a fetched URL. */
  ["abc", "1;2", "", null, undefined].forEach((bad) => {
    const r = L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2,3,4`, { closures: bad });
    assert.ok(!r.closures, "a non-numeric config gid must be ignored: " + bad);
  });
  /* and no config at all is still fine */
  assert.ok(!L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2,3,4`).closures);
});
test("parseSheetFragment: non-numeric gid → null", () => {
  assert.equal(L.parseSheetFragment(`#t=${TOKEN}&g=0,1,abc,3`), null);
});
test("parseSheetFragment: rejects tokens with URL metacharacters", () => {
  /* these values are interpolated into a URL we then fetch */
  assert.equal(L.parseSheetFragment("#t=abc/../evil&g=0,1,2,3"), null);
  assert.equal(L.parseSheetFragment("#t=abc?x=1&g=0,1,2,3"), null);
  assert.equal(L.parseSheetFragment("#t=abc%20def&g=0,1,2,3"), null);
});
test("parseSheetFragment: ignores unrelated fragment keys", () => {
  const s = L.parseSheetFragment(`#foo=bar&t=${TOKEN}&g=0,1,2,3&baz=1`);
  assert.ok(s && s.schedule.includes(TOKEN));
});

/* ---------- day of the day ---------- */
const DAYS = {
  israeli: [
    { heb: "Iyar-5", icon: "🇮🇱", title: "יום העצמאות" },
    { heb: "Adar-14", icon: "🎭", title: "פורים" },
    { heb: "Heshvan-12", icon: "🕯️", title: "יום הזיכרון לרצח רבין" }
  ],
  international: [
    { greg: "03-14", icon: "🥧", title: "יום הפאי" },
    { greg: "04-22", icon: "🌍", title: "יום כדור הארץ" }
  ]
};

test("hebrewKey returns Hebrew month-day for a known date", () => {
  /* 2026-04-22 is 5 Iyar 5786 — Israeli Independence Day */
  assert.equal(L.hebrewKey(new Date(2026, 3, 22)), "Iyar-5");
});
test("dayOfTheDay: Israeli day wins over an international day", () => {
  /* 22 April is both Earth Day and, in 2026, Independence Day */
  const d = L.dayOfTheDay(new Date(2026, 3, 22), DAYS);
  assert.equal(d.title, "יום העצמאות");
});
test("dayOfTheDay: international day used when no Israeli day", () => {
  const d = L.dayOfTheDay(new Date(2026, 2, 14), DAYS);   /* 14 March */
  assert.equal(d.title, "יום הפאי");
});
test("dayOfTheDay: a school-vacation day shows nothing", () => {
  /* nobody is in the corridor to read it */
  const days = {
    israeli: [{ heb: "Iyar-5", title: "יום העצמאות", off: true }],
    international: []
  };
  assert.equal(L.dayOfTheDay(new Date(2026, 3, 22), days), null);
});
test("dayOfTheDay: a vacation day hides an international day too", () => {
  const days = {
    israeli: [{ heb: "Iyar-5", title: "יום העצמאות", off: true }],
    international: [{ greg: "04-22", title: "יום כדור הארץ" }]
  };
  /* 22 Apr 2026 is both; the school is shut, so neither is shown */
  assert.equal(L.dayOfTheDay(new Date(2026, 3, 22), days), null);
});
test("dayOfTheDay: ordinary day returns null", () => {
  assert.equal(L.dayOfTheDay(new Date(2026, 5, 17), DAYS), null);
});
test("dayOfTheDay: no data returns null rather than throwing", () => {
  assert.equal(L.dayOfTheDay(new Date(2026, 5, 17), null), null);
});
test("dayOfTheDay: Adar entries also match Adar II in a leap year", () => {
  /* 5784 is a Hebrew leap year; Purim 2024 fell on 14 Adar II = 24 Mar */
  const d = L.dayOfTheDay(new Date(2024, 2, 24), DAYS);
  assert.ok(d && d.title === "פורים");
});

/* ---------- settings tab ---------- */
test("buildSettings: defaults to the dark theme", () => {
  assert.equal(L.buildSettings([]).theme, "dark");
  assert.equal(L.buildSettings(null).theme, "dark");
});
test("buildSettings: reads the Hebrew theme names", () => {
  assert.equal(L.buildSettings([{ "הגדרה": "ערכת נושא", "ערך": "בהירה" }]).theme, "light");
  assert.equal(L.buildSettings([{ "הגדרה": "ערכת נושא", "ערך": "כהה" }]).theme, "dark");
});
test("buildSettings: the two colourful variants are distinct", () => {
  assert.equal(L.buildSettings([{ "הגדרה": "ערכת נושא", "ערך": "צבעוני 1" }]).theme, "colorful");
  assert.equal(L.buildSettings([{ "הגדרה": "ערכת נושא", "ערך": "צבעוני 2" }]).theme, "colorful2");
});
test("buildSettings: the old name צבעונית still maps to צבעוני 1", () => {
  assert.equal(L.buildSettings([{ "הגדרה": "ערכת נושא", "ערך": "צבעונית" }]).theme, "colorful");
});
test("buildSettings: accepts English names and ignores junk", () => {
  assert.equal(L.buildSettings([{ Setting: "theme", Value: "light" }]).theme, "light");
  assert.equal(L.buildSettings([{ "הגדרה": "ערכת נושא", "ערך": "סגול?" }]).theme, "dark");
  assert.equal(L.buildSettings([{ "הגדרה": "משהו אחר", "ערך": "בהירה" }]).theme, "dark");
});

test("parseSheetFragment: accepts an optional 5th gid for settings", () => {
  const four = L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2,3`);
  assert.equal(four.settings, undefined);
  const five = L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2,3,44`);
  assert.ok(five.settings.includes("gid=44&"));
});

/* ---------- status / error indicator ---------- */
test("statusMessage: everything healthy → no message", () => {
  assert.equal(L.statusMessage({ online: true, sheets: true, pageHost: true }), null);
});
test("statusMessage: unknown state (nothing checked yet) → no message", () => {
  assert.equal(L.statusMessage({}), null);
  assert.equal(L.statusMessage(null), null);
});
test("statusMessage: sheets unreachable", () => {
  assert.equal(L.statusMessage({ online: true, sheets: false, pageHost: true }),
    "מנותק מגוגל שיטס");
});
test("statusMessage: page host unreachable", () => {
  assert.equal(L.statusMessage({ online: true, sheets: true, pageHost: false }),
    "מנותק מגיטהאב");
});
test("statusMessage: browser reports offline wins over everything", () => {
  assert.equal(L.statusMessage({ online: false, sheets: false, pageHost: false }),
    "אין אינטרנט");
});
test("statusMessage: both hosts unreachable reads as no internet", () => {
  /* more useful than blaming one of them when neither answers */
  assert.equal(L.statusMessage({ online: true, sheets: false, pageHost: false }),
    "אין אינטרנט");
});

/* Capture console.error while fn() runs, so a test that deliberately
   provokes a warning asserts on it instead of printing it into the
   suite's output. Returns the lines. */
function captureErrors(fn) {
  const lines = [];
  const real = console.error;
  console.error = (...a) => lines.push(a.join(" "));
  try { fn(); } finally { console.error = real; }
  return lines;
}

/* ---------- how long a fault must last before the wall hears about it ----
   The board reads ELEVEN tabs a minute. One failed request out of eleven
   is routine, and the previous behaviour — flag it instantly — is what
   put "מנותק מגוגל שיטס" over a board that was showing correct data. */
test("sheetsFlag: a clean cycle is connected", () => {
  assert.equal(L.sheetsFlag(0), true);
  assert.equal(L.sheetsFlag(0, 3), true);
});
test("sheetsFlag: ONE failed cycle is not a disconnection", () => {
  /* null, not false: statusMessage() shows nothing for null */
  assert.equal(L.sheetsFlag(1, 3), null);
  assert.equal(L.statusMessage({ online: true, pageHost: true,
                                 sheets: L.sheetsFlag(1, 3) }), null);
});
test("sheetsFlag: two failed cycles are still not enough", () => {
  assert.equal(L.sheetsFlag(2, 3), null);
});
test("sheetsFlag: the limit-th consecutive failure IS a disconnection", () => {
  assert.equal(L.sheetsFlag(3, 3), false);
  assert.equal(L.statusMessage({ online: true, pageHost: true,
                                 sheets: L.sheetsFlag(3, 3) }),
    "מנותק מגוגל שיטס");
});
test("sheetsFlag: it stays false once past the limit", () => {
  assert.equal(L.sheetsFlag(4, 3), false);
  assert.equal(L.sheetsFlag(99, 3), false);
});
test("sheetsFlag: defaults to three cycles when no limit is given", () => {
  assert.equal(L.sheetsFlag(2), null);
  assert.equal(L.sheetsFlag(3), false);
});
test("sheetsFlag: a custom limit of 1 restores the old instant behaviour", () => {
  assert.equal(L.sheetsFlag(1, 1), false);
});
test("sheetsFlag: an unsure sheet never turns pageHost into 'no internet'", () => {
  /* "אין אינטרנט" requires BOTH to be known-bad; a suspicion must not
     upgrade a GitHub outage into a claim about the whole network */
  assert.equal(L.statusMessage({ online: true, pageHost: false,
                                 sheets: L.sheetsFlag(1, 3) }),
    "מנותק מגיטהאב");
});

/* ---------- which tab failed ----------
   "מנותק מגוגל שיטס" on a wall is not a diagnosis. These strings are
   what the indicator's title and the עודכן stamp's title carry, so the
   next person can tell which of the eleven reads is failing without
   instrumenting the browser on the wall. */
test("sheetsFailureNote: nothing wrong → empty, so no tooltip is set", () => {
  assert.equal(L.sheetsFailureNote([], []), "");
  assert.equal(L.sheetsFailureNote(), "");
  assert.equal(L.sheetsFailureNote(null, null), "");
});
test("sheetsFailureNote: names the tabs that could not be read at all", () => {
  assert.equal(L.sheetsFailureNote(["מבחנים"], []), "לא נקראו: מבחנים");
});
test("sheetsFailureNote: names tabs served from the last good copy apart", () => {
  /* a frozen tab is NOT a failure — the board is fine and only that one
     tab is old — so it must not read like one */
  assert.equal(L.sheetsFailureNote([], ["מערכת ז׳", "הודעות"]),
    "מהעותק האחרון: מערכת ז׳, הודעות");
});
test("sheetsFailureNote: both kinds at once, failures first", () => {
  assert.equal(L.sheetsFailureNote(["מערכת"], ["אירועים"]),
    "לא נקראו: מערכת · מהעותק האחרון: אירועים");
});

/* ---------- app.js's data layer ----------
   loadData() needs a browser, so what is pinned here is the SHAPE of it:
   the four properties that, between them, made "מנותק מגוגל שיטס" appear
   over a board that was displaying correct data. Each of these fails
   this test if reverted. The live evidence is in the commit message. */
const APP_SRC = fs.readFileSync(
  path.join(__dirname, "..", "dashboard", "app.js"), "utf8");
/* comments stripped: these tests are about the code, and every one of
   these terms also appears in the prose explaining it */
const APP_CODE = APP_SRC.replace(/\/\*[\s\S]*?\*\//g, "")
                        .replace(/^\s*\/\/.*$/gm, "");

test("app: no path sets SHEETS_OK = false directly", () => {
  /* An assignment straight to false is the old all-or-nothing flag: one
     failed read out of eleven a minute, and the wall says disconnected.
     It has to come from sheetsFlag(), which counts cycles. */
  assert.equal(/SHEETS_OK\s*=\s*false/.test(APP_CODE), false,
    "SHEETS_OK is being set false without going through sheetsFlag()");
  assert.ok(/SHEETS_OK\s*=\s*sheetsFlag\(/.test(APP_CODE),
    "the failure path no longer routes through sheetsFlag()");
});

test("app: a failed cycle counts, a good cycle clears the count", () => {
  assert.ok(/SHEETS_FAILS\+\+/.test(APP_CODE),
    "nothing increments the consecutive-failure count");
  assert.ok(/SHEETS_FAILS\s*=\s*0/.test(APP_CODE),
    "a successful cycle never resets the count, so failures accumulate " +
    "forever and the board eventually flags a fault it recovered from");
});

test("app: every sheet tab is read through the forgiving fetchTab()", () => {
  /* מבחנים, אירועים and הודעות used to be raw fetchCsv() inside a strict
     Promise.all: one HTTP error threw, the catch declared the sheet
     disconnected, and the previous render stayed on screen. */
  ["exams", "events", "messages", "settings", "closures", "schedule"]
    .forEach((tab) => {
      assert.ok(new RegExp(`fetchTab\\("${tab}"`).test(APP_CODE),
        `${tab} is not read through fetchTab()`);
      assert.equal(new RegExp(`fetchCsv\\(SHEETS\\.${tab}\\b`).test(APP_CODE),
        false, `${tab} still bypasses the last-good copy`);
    });
});

test("app: the tab reads settle, so one failure cannot mask the others", () => {
  /* Promise.all rejects on the first failure and leaves the rest in
     flight — so only one tab ever got named, and a late failure filed
     itself against the NEXT cycle, accusing a healthy tab. */
  assert.ok(/const settle = /.test(APP_CODE),
    "the tab reads are back to reject-on-first");
  assert.ok(/broke\.length/.test(APP_CODE),
    "nothing checks the settled results for failures");
});

test("app: a failed read is retried once before it counts as a failure", () => {
  assert.ok(/RETRY_MS/.test(APP_CODE), "fetchCsv no longer retries");
  assert.ok(/Math\.random\(\)/.test(APP_CODE),
    "the retry delay is not jittered, so six grade tabs retry in lockstep");
});

test("app: the failing tabs are named, in the page and not only the console", () => {
  assert.ok(/sheetsFailureNote\(FAILED_TABS, DEGRADED_TABS\)/.test(APP_CODE),
    "renderStatus no longer publishes which tab failed");
  assert.ok(/TAB_NAMES/.test(APP_CODE), "the tabs have no human names");
});

/* ---------- the tombstone: g= position 0 no longer names a live tab ----
   The six-tab migration replaced the single all-grades מערכת tab, and
   its gid now answers HTTP 400. Anything that falls back to it fails on
   every cycle, so the fallback has to be reachable ONLY when there is
   genuinely no s= — never as the silent result of a typo. */
test("parseSheetFragment: a valid s= means the legacy tab is never used", () => {
  const s = L.parseSheetFragment(
    "#d=1AbC_dEf-123&g=0,11,22,33,44&s=1,2,3,4,5,6");
  assert.equal(s.schedules.length, 6);
  s.schedules.forEach((u, i) => assert.ok(u.includes(`gid=${i + 1}`)));
});
test("parseSheetFragment: a malformed s= is ignored but SAYS so", () => {
  let s;
  /* five gids where six are required — the typo that would otherwise
     drop the board onto the dead legacy tab in total silence */
  const errs = captureErrors(() => {
    s = L.parseSheetFragment("#d=1AbC_dEf-123&g=0,11,22,33,44&s=1,2,3,4,5");
  });
  assert.equal(s.schedules, undefined, "a bad s= must not be half-honoured");
  assert.equal(errs.length, 1, "a bad s= must be reported, not swallowed");
  assert.ok(/s=/.test(errs[0]) && /5/.test(errs[0]),
    "the message must say what was wrong with s=");
});
test("parseSheetFragment: a non-numeric s= is ignored and reported", () => {
  let s;
  const errs = captureErrors(() => {
    s = L.parseSheetFragment("#d=1AbC_dEf-123&g=0,11,22,33,44&s=1,2,3,4,5,../evil");
  });
  assert.equal(s.schedules, undefined);
  assert.equal(errs.length, 1);
});
test("parseSheetFragment: NO s= at all is the legacy case and stays quiet", () => {
  let s;
  const errs = captureErrors(() => {
    s = L.parseSheetFragment("#d=1AbC_dEf-123&g=0,11,22,33,44");
  });
  assert.equal(s.schedules, undefined);
  assert.deepEqual(errs, [],
    "an old URL that never had s= is not a misconfiguration");
});

/* ---------- document-id (link-shared) sheet URLs ---------- */
test("parseSheetFragment: #d= builds export URLs for a link-shared sheet", () => {
  const s = L.parseSheetFragment("#d=1AbC_dEf-123&g=0,11,22,33,44");
  assert.ok(s.schedule.includes("/spreadsheets/d/1AbC_dEf-123/export?format=csv&gid=0"));
  assert.ok(s.settings.includes("gid=44"));
  assert.ok(!s.schedule.includes("/d/e/"));      /* not the publish form */
});
test("parseSheetFragment: publish token wins if both are given", () => {
  const s = L.parseSheetFragment(`#t=${TOKEN}&d=1AbC&g=0,1,2,3`);
  assert.ok(s.schedule.includes("/d/e/" + TOKEN + "/pub"));
});
test("parseSheetFragment: rejects a document id with metacharacters", () => {
  assert.equal(L.parseSheetFragment("#d=abc/../evil&g=0,1,2,3"), null);
});

/* ---------- shouldPlayVideo ---------- */
test("shouldPlayVideo: never played → play now", () => {
  assert.ok(L.shouldPlayVideo(null, 1000000, 10));
});
test("shouldPlayVideo: 9 minutes ago → wait", () => {
  const now = 100000000;
  assert.ok(!L.shouldPlayVideo(now - 9 * 60000, now, 10));
});
test("shouldPlayVideo: exactly 10 minutes ago → play", () => {
  const now = 100000000;
  assert.ok(L.shouldPlayVideo(now - 10 * 60000, now, 10));
});
test("shouldPlayVideo: clock moved backwards → play (no lockout)", () => {
  const now = 100000000;
  assert.ok(L.shouldPlayVideo(now + 5 * 60000, now, 10));
});

/* ==================================================================
   Special characters. The principal types free text into the sheet;
   none of it may break the board. These tests cover the full path:
   CSV text → PapaParse → builders → escaped HTML.
   ================================================================== */
const Papa = require("../dashboard/vendor/papaparse.min.js");

test("clean: collapses newlines and repeated whitespace", () => {
  assert.equal(L.clean("שורה\nשנייה"), "שורה שנייה");
  assert.equal(L.clean("  a\t\t b  "), "a b");
});
test("clean: strips bidi override/embedding controls", () => {
  assert.equal(L.clean("שלום‮evil"), "שלוםevil");
  assert.equal(L.clean("⁦x⁩"), "x");
});
test("clean: keeps emoji, quotes, ampersands, plain RLM", () => {
  assert.equal(L.clean('מסיבה 🎉 "כיתה" & עוד'), 'מסיבה 🎉 "כיתה" & עוד');
  assert.equal(L.clean("א‏ב"), "א‏ב");
});
test("esc: neutralizes a script tag typed into a cell", () => {
  assert.equal(L.esc('<script>alert(1)</script>'),
    "&lt;script&gt;alert(1)&lt;/script&gt;");
});
test("esc: escapes quotes so they cannot break out of an attribute", () => {
  assert.equal(L.esc('" onerror="x'), "&quot; onerror=&quot;x");
});

test("CSV round-trip: quotes, commas, newlines, emoji survive", () => {
  /* exactly what Google Sheets publishes for such cells */
  const csv = [
    "הודעה,סוג,קישור,מתאריך,עד תאריך,פעיל",
    '"מבחן ב""לשון"", אולם 3 🎉",רגילה,,,,כן',
    '"שורה\nשנייה",דחופה,,,,כן'
  ].join("\n");
  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  const m = L.buildMessages(parsed.data, TODAY);
  assert.deepEqual(m.normal, ['מבחן ב"לשון", אולם 3 🎉']);
  assert.deepEqual(m.urgent, ["שורה שנייה"]);   /* newline → space */
});

/* ---------- the demo dataset, parsed exactly as the board parses it ----
   sample-data.js is the CSV the Google Sheet publishes, written out by
   hand. If it drifts from the shape setup.gs builds, demo mode stops
   exercising the live path and starts hiding regressions instead. */
function loadSample() {
  const ctx = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "dashboard", "sample-data.js"), "utf8"),
    ctx, { filename: "sample-data.js" });
  return ctx.window.SAMPLE;
}
/* The demo is six per-grade tabs now, in the same shape the sheet
   publishes them — so demo mode runs the live parser, not a shortcut. */
const DEMO_LABELS = ["ז׳", "ח׳", "ט׳", "י׳", 'י"א', 'י"ב'];

function sampleTabs() {
  return loadSample().gradeCsv.map(
    (csv) => Papa.parse(csv, { header: false }).data);
}
function sampleSchedule() {
  const mats = sampleTabs();
  const tabs = mats.map((m, i) => L.parseGradeTab(m, DEMO_LABELS[i]));
  return { s: L.mergeGradeSchedules(tabs, DEMO_LABELS), tabs, mats };
}

test("sample data: six per-grade tabs, each naming its own grade in A1", () => {
  const { s, mats } = sampleSchedule();
  assert.equal(mats.length, 6, "the demo does not have six grade tabs");
  assert.deepEqual(s.grades, ["ז'", "ח'", "ט'", "י'", 'י"א', 'י"ב'],
    "the card headings did not come from each tab's own A1");
  mats.forEach((m, i) => assert.ok(
    /^מערכת שעות לכיתה /.test(m[0][0]),
    "tab " + (i + 1) + " has no title in A1: " + JSON.stringify(m[0][0])));
});

test("sample data: the day letters sit on the FIRST column of each merged pair", () => {
  sampleTabs().forEach((m, i) => {
    const where = "tab " + (i + 1);
    assert.equal(m[0].length, 15, where + " is not 15 columns wide");
    /* D F H J L N carry the letter; E G I K M O are the blank half of
       the merged cell, exactly as Sheets exports one */
    ["א", "ב", "ג", "ד", "ה", "ו"].forEach((d, k) => {
      assert.equal(m[1][3 + k * 2], d, where + " day " + d + " is misplaced");
      assert.equal(m[1][4 + k * 2], "", where + " merged half is not blank");
    });
    assert.equal(m[2][1], "מ-", where + " sub-header B");
    assert.equal(m[2][2], "עד", where + " sub-header C");
    assert.equal(m[2][3], "שיעור", where + " sub-header D");
    assert.equal(m[2][4], "מיקום", where + " sub-header E");
  });
});

test("sample data: ten periods Sunday-Thursday, four on Friday", () => {
  const { s } = sampleSchedule();
  ["א", "ב", "ג", "ד", "ה"].forEach((d) => assert.equal(
    s.byDay[d].length, 10, "day " + d + " is not 10 periods"));
  assert.equal(s.byDay["ו"].length, 4, "Friday is not four periods");
  assert.deepEqual(Object.keys(s.byDay).sort(),
    ["א", "ב", "ג", "ד", "ה", "ו"].sort(),
    "the six day pairs did not become six days");
});

test("sample data: no period 0 — every day starts at 08:15 with period 1", () => {
  const { s, mats } = sampleSchedule();
  mats.forEach((m, i) => m.slice(3).forEach((r, k) => assert.notEqual(
    String(r[0]).trim(), "0",
    "tab " + (i + 1) + " row " + (k + 4) + " still carries a period 0")));
  Object.keys(s.byDay).forEach((d) => {
    assert.equal(s.byDay[d][0].period, "1", "day " + d + " does not open on period 1");
    assert.equal(s.byDay[d][0].start, "08:15", "day " + d + " does not open at 08:15");
  });
  assert.equal(s.byDay["א"][9].end, "17:00", "period 10 should end at 17:00");
  assert.equal(s.byDay["ו"][3].end, "11:40", "Friday should end at 11:40");
});

test("sample data: two-, three- and four-way splits are all exercised", () => {
  const { s } = sampleSchedule();
  const widths = {};
  Object.keys(s.byDay).forEach((d) => s.byDay[d].forEach((p) =>
    s.grades.forEach((g) => {
      const n = p.entries[g].length;
      if (n) widths[n] = (widths[n] || 0) + 1;
    })));
  [2, 3, 4].forEach((n) => assert.ok(widths[n] > 0,
    "the demo has no " + n + "-way concurrent period, so the redesign's " +
    "own case is never rendered in demo mode"));
  /* and the single-value view app.js's legacy path reads still agrees */
  Object.keys(s.byDay).forEach((d) => s.byDay[d].forEach((p) =>
    s.grades.forEach((g) => {
      if (!p.entries[g].length) return;
      assert.equal(p.subjects[g], p.entries[g][0].subject);
      assert.equal(p.rooms[g], p.entries[g][0].room);
    })));
});

test("sample data: a split never leaks into a grade that is not splitting", () => {
  const { s } = sampleSchedule();
  /* Every grade owns its own tab now, so a four-way split in one tab
     cannot possibly reach another — but that is the property worth
     pinning, because it is exactly what went wrong in the single-tab
     shape where an inserted row was shared by every column. */
  let checked = 0;
  Object.keys(s.byDay).forEach((d) => s.byDay[d].forEach((p) => {
    const wide = s.grades.filter((g) => p.entries[g].length > 1);
    if (!wide.length) return;
    checked++;
    s.grades.forEach((g) => {
      if (wide.indexOf(g) >= 0) return;
      assert.ok(p.entries[g].length <= 1,
        d + " period " + p.period + ": the split reached " + g);
    });
  }));
  assert.ok(checked > 0, "no split periods were checked at all");
});

/* LIMITS.scheduleRoom / LIMITS.scheduleSubject in sheet-template/setup.gs —
   demo data the real sheet would reject is demo data that stopped
   describing the sheet. Kept as separate literals (not read out of
   setup.gs) so the two tests below — this one and the sync check right
   after it — fail independently: a limit bumped in setup.gs but not here
   is caught by the sync test even if no demo value happens to exceed the
   old number. */
const ROOM_MAX = 20, SUBJECT_MAX = 30;

test("sample data: every lesson is within the lengths the sheet accepts", () => {
  const { s } = sampleSchedule();
  let roomless = 0;
  Object.keys(s.byDay).forEach((d) => s.byDay[d].forEach((p) => {
    s.grades.forEach((g) => p.entries[g].forEach((e) => {
      const where = `${d} period ${p.period} ${g}: "${e.subject}"`;
      assert.ok(e.subject, where + " has no subject");
      assert.ok(e.subject.length <= SUBJECT_MAX, where + " subject is too long");
      assert.ok(e.room.length <= ROOM_MAX, where + " room is too long: " + e.room);
      if (!e.room) roomless++;
    }));
  }));
  /* A lesson with NO room is real — חנ"ג outdoors, in the school's own
     tabs — so the demo carries one on purpose. Asserting it is present
     stops anyone "fixing" the data and losing the case with it. */
  assert.ok(roomless > 0,
    "the demo no longer contains a lesson with no room, which the real " +
    "sheet does — the roomless render path is now untested");
});
test("LIMITS.scheduleSubject/scheduleRoom in setup.gs match the demo's own limits", () => {
  /* The demo fixture above hardcodes ROOM_MAX/SUBJECT_MAX rather than
     importing setup.gs (a .gs file, not requireable), so nothing forces
     the two to move together. This test is that force: it reads the
     real setup.gs source and parses LIMITS out of it, so a future bump
     to one side alone fails here instead of silently drifting. */
  const src = fs.readFileSync(
    path.join(__dirname, "..", "sheet-template", "setup.gs"), "utf8");
  const subjectMatch = /scheduleSubject:\s*(\d+)/.exec(src);
  const roomMatch = /scheduleRoom:\s*(\d+)/.exec(src);
  assert.ok(subjectMatch, "LIMITS.scheduleSubject not found in setup.gs");
  assert.ok(roomMatch, "LIMITS.scheduleRoom not found in setup.gs");
  assert.equal(Number(subjectMatch[1]), 30,
    "setup.gs LIMITS.scheduleSubject is not 30");
  assert.equal(Number(roomMatch[1]), 20,
    "setup.gs LIMITS.scheduleRoom is not 20");
  assert.equal(Number(subjectMatch[1]), SUBJECT_MAX,
    "setup.gs LIMITS.scheduleSubject and tests/run.js SUBJECT_MAX disagree");
  assert.equal(Number(roomMatch[1]), ROOM_MAX,
    "setup.gs LIMITS.scheduleRoom and tests/run.js ROOM_MAX disagree");
});

test("the sheet the board reads TODAY still parses after the rebuild", () => {
  /* The board ships from this repo before the Google Sheet is rebuilt,
     so for a while the new parser is pointed at the OLD tab: eleven
     periods numbered 0-10, five on Friday, one column per grade and no
     rooms. Exactly the CSV that tab publishes, merged day column and
     all. If this ever fails, deploying the board breaks the wall. */
  const csv = [
    'יום,שיעור,התחלה,סיום,ז׳,ח׳,ט׳,י׳,"י""א","י""ב"',
    'א,0,08:15,08:30,מתמטיקה,ספרות,לשון,אזרחות,ביולוגיה,מחשבים',
    ',1,08:30,09:00,היסטוריה,חינוך גופני,פיזיקה,מתמטיקה,ספרות,לשון',
    ',2,09:00,09:45,כימיה,אנגלית,"תנ""ך",היסטוריה,חינוך גופני,פיזיקה',
    ',7,14:00,14:45,,,מחשבים,כימיה,אנגלית,"תנ""ך"',
    'ו,0,08:15,08:30,אנגלית,"תנ""ך",היסטוריה,חינוך גופני,פיזיקה,מתמטיקה',
    ',4,10:55,11:40,חינוך גופני,חינוך גופני,חינוך גופני,חינוך גופני,חינוך גופני,חינוך גופני'
  ].join("\n");
  const p = Papa.parse(csv, { header: true, skipEmptyLines: true });
  const s = L.buildSchedule(p.data, p.meta.fields);

  assert.deepEqual(s.grades, ["ז׳", "ח׳", "ט׳", "י׳", 'י"א', 'י"ב'],
    "the old six-column shape no longer yields six grades");
  assert.equal(s.byDay["א"].length, 4, "Sunday lost rows from the merged day");
  assert.equal(s.byDay["ו"].length, 2);
  /* period 0 is not a shape this parser knows about — it is simply a row */
  assert.equal(s.byDay["א"][0].period, "0");
  assert.equal(s.byDay["א"][0].start, "08:15");
  /* what app.js actually reads, unchanged */
  assert.equal(s.byDay["א"][0].subjects["ז׳"], "מתמטיקה");
  assert.equal(s.byDay["א"][2].subjects['י"ב'], "פיזיקה");
  assert.equal(s.byDay["א"][3].subjects["ז׳"], "", "an empty cell must stay empty");
  assert.equal(s.byDay["ו"][1].subjects["ט׳"], "חינוך גופני");
  /* and the structured view degrades cleanly: one entry, no room */
  assert.deepEqual(s.byDay["א"][0].entries["ז׳"],
    [{ subject: "מתמטיקה", room: "" }]);
  assert.deepEqual(s.byDay["א"][3].entries["ז׳"], []);
});

test("CSV round-trip: grade names containing quotes match schedule columns", () => {
  const csv = [
    'יום,שיעור,התחלה,סיום,ז׳,"י""א"',
    'א,1,08:00,08:45,מתמטיקה,פיזיקה'
  ].join("\n");
  const p = Papa.parse(csv, { header: true, skipEmptyLines: true });
  const s = L.buildSchedule(p.data, p.meta.fields);
  assert.deepEqual(s.grades, ["ז׳", 'י"א']);
  assert.equal(s.byDay["א"][0].subjects['י"א'], "פיזיקה");
});

test("CSV round-trip: comma inside an event location is not a column break", () => {
  const csv = [
    "תאריך,שכבות,כותרת,התחלה,סיום,מקום",
    `${TODAY},"ז׳, ח׳",טקס,09:00,10:00,"אולם ספורט, קומה 2"`
  ].join("\n");
  const p = Papa.parse(csv, { header: true, skipEmptyLines: true });
  const a = L.buildAgenda([], p.data, TODAY);
  assert.equal(a.length, 1);
  assert.deepEqual(a[0].grades, ["ז׳", "ח׳"]);
  assert.equal(a[0].room, "אולם ספורט, קומה 2");
});

test("buildMessages: the long link header is matched by its prefix", () => {
  const rows = [{ "הודעה": "", "סוג": "וידאו",
    "קישור לוידאו (Google Drive או YouTube)": "https://youtu.be/abc123XYZ",
    "סאונד": "לא", "מתאריך": "", "עד תאריך": "", "פעיל": "כן" }];
  const m = L.buildMessages(rows, TODAY);
  assert.deepEqual(m.videos, [{ kind: "youtube", id: "abc123XYZ", sound: false }]);
});
test("buildMessages: the סאונד column turns audio on", () => {
  const rows = [{ "הודעה": "", "סוג": "וידאו",
    "קישור לוידאו (Google Drive או YouTube)": "https://youtu.be/abc123XYZ",
    "סאונד": "כן", "מתאריך": "", "עד תאריך": "", "פעיל": "כן" }];
  assert.equal(L.buildMessages(rows, TODAY).videos[0].sound, true);
});
test("buildMessages: a Drive share link becomes playable", () => {
  const rows = [{ "הודעה": "", "סוג": "וידאו",
    "קישור לוידאו (Google Drive או YouTube)":
      "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=drive_link",
    "סאונד": "לא", "מתאריך": "", "עד תאריך": "", "פעיל": "כן" }];
  const v = L.buildMessages(rows, TODAY).videos[0];
  assert.equal(v.kind, "file");
  assert.ok(v.src.indexOf("uc?export=download&id=1AbCdEfGhIjKlMnOp") > 0);
});

/* ---------- the אופן הצגת שיעורים setting ---------- */
const SET_FIELDS = ["הגדרה", "ערך"];
const setRows = (name, val) => [{ "הגדרה": name, "ערך": val }];

test("buildSettings: reads the whole-day option", () => {
  const s = L.buildSettings(setRows("אופן הצגת שיעורים", "הצג את כל השיעורים ביום"));
  assert.equal(s.lessons, "all");
});
test("buildSettings: reads the upcoming-only option", () => {
  const s = L.buildSettings(setRows("אופן הצגת שיעורים", "הצג רק משיעור נוכחי ואילך"));
  assert.equal(s.lessons, "upcoming");
});
test("buildSettings: an unset or unknown value stays null, not a guess", () => {
  assert.equal(L.buildSettings([]).lessons, null);
  assert.equal(L.buildSettings(setRows("אופן הצגת שיעורים", "")).lessons, null);
  assert.equal(L.buildSettings(setRows("אופן הצגת שיעורים", "משהו אחר")).lessons, null);
});
test("buildSettings: the two settings do not interfere", () => {
  const s = L.buildSettings([
    { "הגדרה": "ערכת נושא", "ערך": "בהירה" },
    { "הגדרה": "אופן הצגת שיעורים", "ערך": "הצג רק משיעור נוכחי ואילך" }
  ]);
  assert.equal(s.theme, "light");
  assert.equal(s.lessons, "upcoming");
});
/* The sheet's option texts and the board's lookup table are one
   interface across two files; if they drift, the principal's choice is
   silently read as "unset". */
test("the sheet's option texts match the board's", () => {
  const setup = fs.readFileSync(
    path.join(__dirname, "..", "sheet-template", "setup.gs"), "utf8");
  const m = /var LESSON_VIEW = \[([^\]]*)\]/.exec(setup);
  assert.ok(m, "LESSON_VIEW not found in setup.gs");
  const texts = m[1].split(",").map((t) => t.trim().replace(/^'|'$/g, ""));
  assert.equal(texts.length, 2);
  texts.forEach((t) => {
    const got = L.buildSettings(setRows("אופן הצגת שיעורים", t)).lessons;
    assert.ok(got, `the board does not recognise "${t}" from setup.gs`);
  });
  assert.equal(L.buildSettings(setRows("אופן הצגת שיעורים", texts[0])).lessons,
    "upcoming", "first option should mean upcoming-only");
  assert.equal(L.buildSettings(setRows("אופן הצגת שיעורים", texts[1])).lessons,
    "all", "second option should mean the whole day");
});

/* ---------- days.js actually loads, and every entry is usable ----------
   A syntax check is not enough here: days.js is a list of art constants
   followed by a table that references them, so deleting or reordering one
   constant leaves the file perfectly parseable and throws only when it
   runs. That failure is silent on the board — window.DAYS never gets
   assigned, and the special-day pane simply never appears again. */
function loadDays() {
  const ctx = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "dashboard", "days.js"), "utf8"),
    ctx, { filename: "days.js" });
  return ctx.window.DAYS;
}
test("days.js runs and defines window.DAYS", () => {
  const d = loadDays();
  assert.ok(d && d.israeli && d.international, "window.DAYS was not assigned");
  assert.ok(d.israeli.length > 15 && d.international.length > 15);
});
test("every day has a title and exactly one kind of art", () => {
  const d = loadDays();
  [].concat(d.israeli, d.international).forEach((e) => {
    assert.ok(e.title && e.title.trim(), "an entry has no title");
    const art = (e.icon ? 1 : 0) + (e.svg ? 1 : 0);
    assert.equal(art, 1, `"${e.title}" should have either icon or svg, has ${art}`);
    if (e.svg) assert.ok(/^<(svg|span)/.test(e.svg),
      `"${e.title}" svg does not start with markup — a missing constant ` +
      `would arrive here as undefined`);
  });
});
test("every day is keyed by a Hebrew or Gregorian date", () => {
  const d = loadDays();
  d.israeli.forEach((e) => assert.ok(e.heb || e.greg, `"${e.title}" has no date key`));
  d.international.forEach((e) =>
    assert.ok(/^\d{2}-\d{2}$/.test(e.greg || ""), `"${e.title}" has a bad greg key`));
});
test("the two removed days are gone", () => {
  const titles = [].concat(loadDays().israeli, loadDays().international)
    .map((e) => e.title);
  ["היום הבינלאומי לשפת האם",
   "יום הזיכרון לחללים שמקום קבורתם לא נודע"].forEach((t) =>
    assert.ok(titles.indexOf(t) < 0, t + " is still listed"));
});

/* ---------- vacations: the board must be empty when school is shut ----
   This is a regression guard with real history. The board used to mark
   vacations by a single Hebrew date, so it covered only the FIRST day of
   each multi-day break — 37 vacation days went unmarked, and the entire
   Hanukkah break was missed because Kislev 25 fell the day before the
   ministry's break began. The per-day coverage test below is the check
   that would have caught it.

   vacations.js is also loaded rather than merely parsed, for the same
   reason days.js is: a file that assigns nothing is valid JavaScript,
   and the failure would be silent on the wall. */
function loadVacations() {
  const ctx = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "dashboard", "vacations.js"), "utf8"),
    ctx, { filename: "vacations.js" });
  return ctx.window.VACATIONS;
}
const D = (k) => new Date(k + "T12:00:00");

test("vacations.js runs and defines window.VACATIONS", () => {
  const v = loadVacations();
  assert.ok(Array.isArray(v) && v.length >= 8,
    "window.VACATIONS was not assigned, or is suspiciously short");
});

test("every vacation range is well formed and of sane length", () => {
  loadVacations().forEach((v) => {
    assert.ok(v.title && v.title.trim(), "a range has no title");
    [v.from, v.to].forEach((k) => assert.ok(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(k || ""),
      `"${v.title}" has a bad date key: ${k}`));
    assert.ok(v.to >= v.from, `"${v.title}" ends before it starts`);
    /* The ministry feed ships one malformed 369-day "summer" record. If it
       ever reaches this file it would blank the board for a whole year. */
    const days = Math.round((D(v.to) - D(v.from)) / 864e5) + 1;
    assert.ok(days <= 100, `"${v.title}" spans ${days} days — the bad feed record?`);
  });
});

test("vacationOn is inclusive at both ends and exact at the edges", () => {
  const v = [{ from: "2027-04-13", to: "2027-04-28", title: "פסח" }];
  assert.equal(L.vacationOn(D("2027-04-12"), v), null, "the day before must be a school day");
  assert.equal(L.vacationOn(D("2027-04-13"), v).title, "פסח", "first day must count");
  assert.equal(L.vacationOn(D("2027-04-28"), v).title, "פסח", "last day must count");
  assert.equal(L.vacationOn(D("2027-04-29"), v), null, "the day after must be a school day");
});

test("vacationOn copes with no data at all", () => {
  assert.equal(L.vacationOn(D("2027-04-13"), []), null);
  assert.equal(L.vacationOn(D("2027-04-13"), null), null);
});

test("EVERY day of every ministry vacation is covered", () => {
  const v = loadVacations();
  const MOE = [
    ["ראש השנה", "2026-09-11", "2026-09-13"],
    ["יום כיפור", "2026-09-20", "2026-09-21"],
    ["סוכות", "2026-09-22", "2026-10-03"],
    ["חנוכה", "2026-12-06", "2026-12-12"],
    ["פורים", "2027-03-23", "2027-03-24"],
    ["פסח", "2027-04-13", "2027-04-28"],
    ["יום העצמאות", "2027-05-12", "2027-05-12"],
    ["שבועות", "2027-06-10", "2027-06-11"]
  ];
  const missing = [];
  MOE.forEach(([name, from, to]) => {
    for (let d = D(from); d <= D(to); d.setDate(d.getDate() + 1)) {
      if (!L.vacationOn(d, v)) missing.push(name + " " + d.toISOString().slice(0, 10));
    }
  });
  assert.equal(missing.length, 0, "uncovered vacation days: " + missing.join(", "));
});

test("ordinary school days are NOT vacations", () => {
  const v = loadVacations();
  ["2026-09-01", "2026-11-10", "2027-01-20", "2027-03-02", "2027-05-25"]
    .forEach((k) => assert.equal(L.vacationOn(D(k), v), null,
      k + " must be a school day — a board that blanks during term is worse " +
      "than one that runs during a holiday"));
});

test("summer 2026 is deliberately NOT covered, but 2027 is, throughout", () => {
    const v = loadVacations();
    /* The board went up during the 2026 summer break and is being shown to
       the principal and to visitors. Blanking it then would have hidden
       the very thing they were brought to look at, so this one summer is
       left uncovered ON PURPOSE — it is not an oversight to "fix".
       It ends by itself: the school year starts on 1 September 2026 and
       no later summer gets the same exemption. */
    ["2026-08-28", "2026-08-31"].forEach((k) => assert.equal(
      L.vacationOn(D(k), v), null,
      k + " must stay a working board — the preview window"));

    /* Every following summer goes quiet for its whole length. 20 June is
       the high-school end of year; elementary schools run to 1 July. */
    ["2027-06-20", "2027-07-15", "2027-08-31"].forEach((k) => assert.ok(
      L.vacationOn(D(k), v), k + " must be covered by the summer break"));
    assert.equal(L.vacationOn(D("2027-06-19"), v), null,
      "the day before the summer break is still a school day");
  });

  test("the three days that used to show a pane to a closed school are covered", () => {
  const v = loadVacations();
  [["2026-10-01", "יום המוזיקה, during Sukkot"],
   ["2026-12-10", "יום זכויות האדם, during Hanukkah"],
   ["2027-04-23", "יום הספר, during Pesach"]]
    .forEach(([k, why]) => assert.ok(L.vacationOn(D(k), v), k + " — " + why));
});

/* ---------- theme names ----------
   The two colourful themes were renamed and swapped: the pale one became
   צבעונית 1, the saturated one צבעונית 2. The sheet on the wall still
   holds whichever text was chosen before that, and setup() deliberately
   never rewrites what the principal typed — so every superseded name has
   to keep resolving. If one stopped, the board would fall back to the
   dark theme overnight and nobody would know why. */
const themeOf = (v) => L.buildSettings([{ "הגדרה": "ערכת נושא", "ערך": v }]).theme;

test("theme: the new names map to the right palettes", () => {
  assert.equal(themeOf("צבעונית 1"), "colorful2", "the pale theme");
  assert.equal(themeOf("צבעונית 2"), "colorful", "the saturated theme");
});

test("theme: every superseded name still resolves", () => {
  assert.equal(themeOf("צבעוני 1"), "colorful");
  assert.equal(themeOf("צבעוני 2"), "colorful2");
  assert.equal(themeOf("צבעונית"), "colorful");
  assert.equal(themeOf("כהה"), "dark");
  assert.equal(themeOf("בהירה"), "light");
});

test("theme: the names in setup.gs are exactly what the board accepts", () => {
  /* These two lists are the interface between the sheet and the board. A
     silent drift between them is invisible until the principal picks the
     option that no longer resolves. */
  const gs = fs.readFileSync(
    path.join(__dirname, "..", "sheet-template", "setup.gs"), "utf8");
  const m = /var THEMES = \[([^\]]+)\]/.exec(gs);
  assert.ok(m, "THEMES not found in setup.gs");
  const offered = m[1].split(",").map((x) => x.trim().replace(/^'|'$/g, ""));
  /* Checking the result is merely truthy proves nothing: an unrecognised
     value falls back to "dark", which is a perfectly truthy answer. The
     drift this test exists to catch would sail straight through. So an
     offered name must resolve to something OTHER than the fallback —
     except כהה, which legitimately is it. */
  offered.forEach((name) => {
    const t = themeOf(name);
    if (name === "כהה") { assert.equal(t, "dark"); return; }
    assert.notEqual(t, "dark",
      'setup.gs offers "' + name + '" but the board does not recognise it, ' +
      'so choosing it would silently give the dark theme');
  });
});

/* ---------- ימים ללא לימודים (the sheet's own closures) ----------
   The ministry feed cannot know about a trip, an outing or a strike, so
   the principal types those into the sheet. The board must treat them
   exactly as carefully as the published calendar — and must fail SAFE:
   a half-typed or unreadable row leaves the timetable on screen rather
   than blanking a working board. */
const GR = ["ז׳", "ח׳", "ט׳", "י׳"];

test("buildClosures: a whole-school closure via כולם", () => {
  const c = L.buildClosures([
    { "מתאריך": "2026-11-10", "עד תאריך": "", "סיבה": "שביתה", "כולם": "TRUE" }
  ], GR);
  assert.equal(c.length, 1);
  assert.equal(c[0].all, true);
  assert.equal(c[0].reason, "שביתה");
  /* a blank end date means a single day */
  assert.equal(c[0].from, "2026-11-10");
  assert.equal(c[0].to, "2026-11-10");
});

test("buildClosures: a multi-day, single-grade closure", () => {
  const c = L.buildClosures([
    { "מתאריך": "10/11/2026", "עד תאריך": "12/11/2026",
      "סיבה": "טיול שנתי", "ט׳": "TRUE" }
  ], GR);
  assert.equal(c[0].all, false);
  assert.deepEqual(c[0].grades, ["ט׳"]);
  assert.equal(c[0].to, "2026-11-12");
});

test("buildClosures: ticking every grade means the whole school", () => {
  const row = { "מתאריך": "2026-11-10", "סיבה": "יום מעשים טובים" };
  GR.forEach((g) => { row[g] = "TRUE"; });
  assert.equal(L.buildClosures([row], GR)[0].all, true);
});

test("buildClosures: a row missing its date or reason is ignored", () => {
  assert.equal(L.buildClosures([
    { "מתאריך": "", "סיבה": "טיול שנתי", "כולם": "TRUE" },
    { "מתאריך": "2026-11-10", "סיבה": "", "כולם": "TRUE" }
  ], GR).length, 0, "a half-typed row must never blank the board");
});

test("buildClosures: dates entered backwards do not vanish", () => {
  const c = L.buildClosures([
    { "מתאריך": "2026-11-12", "עד תאריך": "2026-11-10",
      "סיבה": "טיול", "כולם": "TRUE" }
  ], GR);
  assert.equal(c[0].to, "2026-11-12", "should collapse to the single day");
});

test("closureFor: whole-school beats per-grade on the same day", () => {
  const c = L.buildClosures([
    { "מתאריך": "2026-11-10", "סיבה": "טיול שנתי", "ט׳": "TRUE" },
    { "מתאריך": "2026-11-10", "סיבה": "שביתה", "כולם": "TRUE" }
  ], GR);
  const d = new Date("2026-11-10T12:00:00");
  assert.equal(L.closureFor(d, c).reason, "שביתה");
  assert.equal(L.closureFor(d, c, "ז׳").reason, "שביתה",
    "a grade with no closure of its own is still shut by the school-wide one");
});

test("closureFor: a per-grade closure touches only that grade", () => {
  const c = L.buildClosures([
    { "מתאריך": "2026-11-10", "עד תאריך": "2026-11-12",
      "סיבה": "טיול שנתי", "ט׳": "TRUE" }
  ], GR);
  const d = new Date("2026-11-11T12:00:00");
  assert.equal(L.closureFor(d, c), null, "not a whole-school closure");
  assert.equal(L.closureFor(d, c, "ט׳").reason, "טיול שנתי");
  assert.equal(L.closureFor(d, c, "ח׳"), null, "another grade must be unaffected");
});

test("closureFor: outside the range, and with no data", () => {
  const c = L.buildClosures([
    { "מתאריך": "2026-11-10", "עד תאריך": "2026-11-12",
      "סיבה": "טיול", "ט׳": "TRUE" }
  ], GR);
  assert.equal(L.closureFor(new Date("2026-11-09T12:00:00"), c, "ט׳"), null);
  assert.equal(L.closureFor(new Date("2026-11-13T12:00:00"), c, "ט׳"), null);
  assert.equal(L.closureFor(new Date("2026-11-11T12:00:00"), [], "ט׳"), null);
  assert.equal(L.closureFor(new Date("2026-11-11T12:00:00"), null, "ט׳"), null);
});

test("a whole-school closure reaches EVERY grade and is not a vacation", () => {
  /* The two sources produce different screens on purpose. A ministry
     vacation replaces the board with one quiet line; a closure the school
     typed itself always speaks through the grade cards, even when it
     covers all of them — the sheet's own wording ("טיול שנתי", "שביתה")
     says more than any single borrowed headline could. */
  const c = L.buildClosures(
    [{ "מתאריך": "2026-11-10", "סיבה": "שביתה", "כולם": "TRUE" }], GR);
  const d = new Date("2026-11-10T12:00:00");
  GR.forEach((g) => assert.equal(
    L.closureFor(d, c, g).reason, "שביתה",
    "grade " + g + " should carry the reason on its own card"));
  assert.equal(L.vacationOn(d, loadVacations()), null,
    "a school closure must NOT trigger the ministry-vacation screen");
});


/* ==================================================================
   THE PER-GRADE מערכת TABS

   The fixture is a real tab's published CSV shape, anonymised: the same
   title row, the same merged day letters, the same four-row blocks,
   the same escaped quotes and commas inside quoted cells. It is
   deliberately not generated — a generated fixture only tests the
   generator's idea of the format.
   ================================================================== */
function gradeFixture() {
  const csv = fs.readFileSync(
    path.join(__dirname, "fixtures", "grade-tab.csv"), "utf8");
  return Papa.parse(csv.replace(/\r\n/g, "\n"), { header: false }).data;
}
const FIX = gradeFixture();

test("grade tab: A1 names the grade, prefix stripped, quotes unescaped", () => {
  const t = L.parseGradeTab(FIX, "fallback");
  assert.equal(t.label, 'י"א');
});

test("grade tab: the label falls back when A1 says nothing useful", () => {
  assert.equal(L.parseGradeTab([["מערכת שעות"], [], []], "ז׳").label, "ז׳");
  assert.equal(L.parseGradeTab([[""], [], []], "ז׳").label, "ז׳");
  assert.equal(L.parseGradeTab([], "ז׳").label, "ז׳");
  /* a title that is nothing BUT the prefix names no grade, and must not
     leave the whole sentence sitting in the card heading */
  assert.equal(L.gradeLabelFromTitle("מערכת שעות לכיתה"), "");
  assert.equal(L.gradeLabelFromTitle("מערכת שעות לשכבה  ט׳ "), "ט׳");
});

test("grade tab: one lesson per day on a plain period", () => {
  const t = L.parseGradeTab(FIX, "?");
  const first = (d) => t.byDay[d][0];
  assert.equal(first("א").period, "1");
  assert.equal(first("א").start, "08:15");
  assert.equal(first("א").end, "09:00");
  assert.deepEqual(first("א").classes, [{ subject: "מתמטיקה", room: "יא" }]);
  /* the merged day letters really did map D:E→א … N:O→ו */
  assert.equal(first("ב").classes[0].subject, "ערבית");
  assert.equal(first("ג").classes[0].subject, "היסטוריה");
  assert.equal(first("ד").classes[0].subject, "עברית");
  assert.equal(first("ה").classes[0].subject, 'תנ"ך');
  assert.equal(first("ו").classes[0].subject, "ספרות");
});

test("grade tab: split periods carry every concurrent class, in sheet order", () => {
  const t = L.parseGradeTab(FIX, "?");
  const at = (d, p) => t.byDay[d].find((s) => s.period === p);
  assert.deepEqual(at("א", "2").classes, [
    { subject: "מתמטיקה 5 (מורה א)", room: "יא" },
    { subject: "מתמטיקה 4 (מורה ב)", room: "מרכז למידה" }
  ]);
  assert.equal(at("ב", "2").classes.length, 3, "the three-way split");
  assert.deepEqual(at("ג", "2").classes.map((c) => c.subject),
    ["ביולוגיה", "כימיה", "פיזיקה", "מדעי המחשב"],
    "the four-way split, in the order the rows appear");
  /* the rows of one block belong to one period, not to four */
  assert.equal(at("ג", "2").start, "09:00");
  assert.equal(at("ג", "2").end, "09:45");
});

test("grade tab: a co-teacher line keeps its comma and its brackets", () => {
  const t = L.parseGradeTab(FIX, "?");
  const p3 = t.byDay["א"].find((s) => s.period === "3");
  assert.deepEqual(p3.classes, [
    { subject: "אנגלית (מורה א, מורה ב)", room: "אנגלית" },
    { subject: "אנגלית (מורה ד, מורה ה)", room: "יא" }
  ], "a comma inside a quoted cell must not split the lesson in two");
});

test("grade tab: a lesson with no room is still a lesson", () => {
  const t = L.parseGradeTab(FIX, "?");
  const p3 = t.byDay["ב"].find((s) => s.period === "3");
  assert.deepEqual(p3.classes, [
    { subject: 'חנ"ג בנות (מורה ג)', room: "" },
    { subject: 'חנ"ג בנים (מורה ו)', room: "אולם ספורט" }
  ], "an outdoor class has no room and must not be dropped");
});

test("grade tab: a room with no lesson beside it is dropped", () => {
  const t = L.parseGradeTab(FIX, "?");
  const p3 = t.byDay["ד"].find((s) => s.period === "3");
  assert.equal(p3, undefined,
    "a leftover room cell invented a blank lesson with a pin and no name");
});

test("grade tab: a short room code passes through verbatim, never expanded with חדר", () => {
  /* The real sheet's per-grade tabs deliberately drop the word "חדר" when
     the room is typed in — a room cell just says "ז", not "חדר ז". The
     board must show exactly what the cell says: no prefixing, no
     expansion, no normalisation of the display string. */
  const m = [
    ["מערכת שעות לכיתה ז'"],
    ["", "", "", "א", "", "ב", "", "ג", "", "ד", "", "ה", "", "ו", ""],
    ["", "מ-", "עד", "שיעור", "מיקום"],
    ["1", "08:15", "09:00", "מדעים", "ז"]
  ];
  const t = L.parseGradeTab(m, "?");
  assert.deepEqual(t.byDay["א"][0].classes, [{ subject: "מדעים", room: "ז" }],
    "the short room code was rewritten instead of passed through as-is");
});

test("mergeGradeSchedules: a short room code stays short through the merge", () => {
  const tab = L.parseGradeTab([
    ["מערכת שעות לכיתה ז'"],
    ["", "", "", "א", "", "ב", "", "ג", "", "ד", "", "ה", "", "ו", ""],
    ["", "מ-", "עד", "שיעור", "מיקום"],
    ["1", "08:15", "09:00", "מדעים", "ז"]
  ], "ז׳");
  const s = L.mergeGradeSchedules([tab], ["ז׳"]);
  const g = s.grades[0];             /* tab.label wins over the fallback,
                                         and A1 wrote an ASCII apostrophe */
  const p = s.byDay["א"][0];
  assert.equal(p.rooms[g], "ז", "the merged model expanded the room name");
  assert.deepEqual(p.entries[g], [{ subject: "מדעים", room: "ז" }]);
});

test("grade tab: an entirely empty block produces no period at all", () => {
  const t = L.parseGradeTab(FIX, "?");
  ["א", "ב", "ג", "ד", "ה", "ו"].forEach((d) => assert.ok(
    !t.byDay[d].some((s) => s.period === "4"),
    "day " + d + " invented an empty period 4"));
});

test("grade tab: Friday stops early, and the later periods are simply absent", () => {
  const t = L.parseGradeTab(FIX, "?");
  assert.deepEqual(t.byDay["ו"].map((s) => s.period), ["1", "2", "5", "6"]);
  assert.ok(!t.byDay["ו"].some((s) => +s.period > 6),
    "Friday carries a period it does not run");
});

test("grade tab: a short final block (Sheets trims trailing rows) still parses", () => {
  const t = L.parseGradeTab(FIX, "?");
  const last = t.byDay["א"][t.byDay["א"].length - 1];
  assert.equal(last.period, "8");
  assert.deepEqual(last.classes, [{ subject: "חינוך", room: "יא" }]);
});

test("grade tab: periods come out in time order whatever order they are written", () => {
  const t = L.parseGradeTab(FIX, "?");
  Object.keys(t.byDay).forEach((d) => {
    const mins = t.byDay[d].map((s) => L.minutes(s.start));
    assert.deepEqual(mins.slice().sort((a, b) => a - b), mins,
      "day " + d + " is not in time order");
  });
});

test("grade tab: rows above the first block are ignored, not attached", () => {
  /* a stray note typed under the header would otherwise become a lesson
     belonging to nothing */
  const m = FIX.map((r) => r.slice());
  m.splice(3, 0, ["", "", "", "הערה של המזכירות", "", "", "", "", "", "",
                  "", "", "", "", ""]);
  const t = L.parseGradeTab(m, "?");
  assert.ok(!t.byDay["א"].some((s) =>
    s.classes.some((c) => c.subject === "הערה של המזכירות")),
    "a row above the first period became a lesson");
});

test("grade tab: a block with no usable times opens nothing", () => {
  const m = FIX.map((r) => r.slice());
  m[3] = m[3].slice();
  m[3][1] = "";                       /* period 1 loses its start time */
  const t = L.parseGradeTab(m, "?");
  assert.ok(!t.byDay["א"].some((s) => s.period === "1"),
    "a period with no start time was placed on the board anyway");
  /* and its rows fell to the block above, which is nothing — not to the
     block below, which would have shifted every lesson by one period */
  assert.equal(t.byDay["א"][0].period, "2");
});

test("grade tab: a missing day row falls back to א-ו by position", () => {
  const m = FIX.map((r) => r.slice());
  m[1] = new Array(15).fill("");
  const t = L.parseGradeTab(m, "?");
  assert.deepEqual(Object.keys(t.byDay).sort(), ["א", "ב", "ג", "ד", "ה", "ו"].sort());
  assert.equal(t.byDay["ג"][0].classes[0].subject, "היסטוריה");
});

test("mergeGradeSchedules: six tabs become one model in the shipped shape", () => {
  const labels = ["ז׳", "ח׳", "ט׳", "י׳", 'י"א', 'י"ב'];
  const tabs = labels.map(() => L.parseGradeTab(FIX, "?"));
  const s = L.mergeGradeSchedules(tabs, labels);
  /* the tabs all name themselves י"א here, so the duplicate guard fires;
     what matters is that six tabs still yield six distinct grades */
  assert.equal(s.grades.length, 6);
  assert.equal(new Set(s.grades).size, 6, "two grades collapsed into one card");
  const p2 = s.byDay["ג"].find((p) => p.period === "2");
  assert.equal(p2.entries[s.grades[0]].length, 4);
  assert.equal(p2.subjects[s.grades[0]], "ביולוגיה");
  assert.equal(p2.rooms[s.grades[0]], "מעבדה");
});

test("mergeGradeSchedules: an unreadable tab keeps its card and its colour", () => {
  const labels = ["ז׳", "ח׳", "ט׳", "י׳", 'י"א', 'י"ב'];
  /* each tab titles itself, as the real ones do; tab 3 (ט׳) arrives
     empty, which is what an unreadable fetch looks like after the
     per-tab fallback has nothing cached either */
  const titled = (l) => {
    const m = FIX.map((r) => r.slice());
    m[0] = m[0].slice();
    m[0][0] = "מערכת שעות לכיתה " + l;
    return m;
  };
  const tabs = labels.map((l, i) =>
    i === 2 ? L.parseGradeTab([], l) : L.parseGradeTab(titled(l), l));
  const s = L.mergeGradeSchedules(tabs, labels);
  assert.deepEqual(s.grades, labels,
    "the unreadable grade lost its place, shifting every accent colour after it");
  Object.keys(s.byDay).forEach((d) => s.byDay[d].forEach((p) => {
    assert.deepEqual(p.entries["ט׳"], [], "the empty tab invented lessons");
    labels.forEach((g) => assert.ok(Array.isArray(p.entries[g]),
      "grade " + g + " has no entries array on " + d + " period " + p.period));
  }));
  /* the other five are unaffected */
  const p2 = s.byDay["ג"].find((p) => p.period === "2");
  assert.equal(p2.entries['י"ב'].length, 4);
});

test("mergeGradeSchedules: grades with different days keep their own periods", () => {
  const other = L.parseGradeTab([
    ["מערכת שעות לכיתה ח׳"],
    ["", "", "", "א", "", "ב", "", "ג", "", "ד", "", "ה", "", "ו", ""],
    ["", "מ-", "עד"],
    ["1", "07:30", "08:10", "אסיפת בוקר", "ח"]
  ], "ח׳");
  const s = L.mergeGradeSchedules([L.parseGradeTab(FIX, "?"), other],
                                  ["א", "ב"]);
  const early = s.byDay["א"].find((p) => p.start === "07:30");
  assert.ok(early, "the second grade's earlier period is missing");
  assert.deepEqual(early.entries[s.grades[0]], [],
    "the first grade was given a lesson it does not have");
  assert.equal(early.entries[s.grades[1]][0].subject, "אסיפת בוקר");
  assert.equal(s.byDay["א"][0].start, "07:30", "days are not in time order");
});

/* ==================================================================
   MATCHING A GRADE ACROSS TABS

   The timetable tabs write ז' with an ASCII apostrophe; the events and
   closures tabs head their tick columns with a Hebrew geresh, ז׳. They
   look identical and are not equal.
   ================================================================== */
test("gradeCell: a geresh column is found by an apostrophe grade, and back", () => {
  assert.equal(L.gradeCell({ "ז׳": "TRUE" }, "ז'"), "TRUE");
  assert.equal(L.gradeCell({ "ז'": "TRUE" }, "ז׳"), "TRUE");
  assert.equal(L.gradeCell({ 'י"א': "TRUE" }, "י״א"), "TRUE");
  assert.equal(L.gradeCell({ "ז": "TRUE" }, "ז׳"), "TRUE");
  assert.equal(L.gradeCell({ "ח׳": "TRUE" }, "ז׳"), undefined,
    "a different grade must not match");
  assert.equal(L.gradeCell(null, "ז׳"), undefined);
});

test("buildAgenda: an event ticked with a geresh reaches an apostrophe grade", () => {
  const rows = [{ "תאריך": TODAY, "כותרת": "חזרה לטקס",
                  "התחלה": "10:00", "סיום": "11:00", "מקום": "אולם",
                  "ז׳": "TRUE", "ח׳": "FALSE" }];
  const out = L.buildAgenda([], rows, TODAY, ["ז'", "ח'"]);
  assert.deepEqual(out[0].grades, ["ז'"],
    "the tick did not reach the grade, so the chip would vanish silently");
});

test("buildClosures: a closure ticked with a geresh reaches an apostrophe grade", () => {
  const c = L.buildClosures(
    [{ "מתאריך": "2026-11-10", "סיבה": "טיול שנתי", "ט׳": "TRUE" }],
    ["ז'", "ח'", "ט'"]);
  assert.deepEqual(c[0].grades, ["ט'"]);
  assert.equal(L.closureFor(new Date("2026-11-10T12:00:00"), c, "ט'").reason,
    "טיול שנתי");
});

/* ==================================================================
   WHAT A CARD SHOWS — display mode, end of day, and the retained lesson
   ================================================================== */
const DAY = [
  { start: "08:15", end: "09:00" },   /* 0 */
  { start: "09:00", end: "09:45" },   /* 1 */
  { start: "10:10", end: "10:55" },   /* 2 */
  { start: "10:55", end: "11:40" },   /* 3 */
  { start: "12:00", end: "12:45" }    /* 4 */
];
const at = (hhmm) => L.minutes(hhmm);

test("visibleSlots: show-all keeps the whole day, all day", () => {
  [ "08:00", "09:20", "09:50", "12:30" ].forEach((t) => assert.deepEqual(
    L.visibleSlots(DAY, at(t), { hide: false }), [0, 1, 2, 3, 4],
    "at " + t));
});

test("visibleSlots: hide-mode drops each lesson as it finishes", () => {
  assert.deepEqual(L.visibleSlots(DAY, at("08:00"), { hide: true }),
    [0, 1, 2, 3, 4]);
  assert.deepEqual(L.visibleSlots(DAY, at("09:20"), { hide: true }),
    [1, 2, 3, 4], "the 08:15 lesson is over");
  assert.deepEqual(L.visibleSlots(DAY, at("11:00"), { hide: true }),
    [3, 4]);
});

test("visibleSlots: hide-mode holds the just-finished lesson through a break", () => {
  /* 09:45-10:10 is a break: nothing running, something finished,
     something still to come. Without this the break marker has no
     lesson above it to hang under and hide-mode says nothing at all
     about being on a break. */
  assert.deepEqual(L.visibleSlots(DAY, at("09:50"), { hide: true }),
    [1, 2, 3, 4], "the lesson that just ended was not retained");
  /* ONLY that one — the 08:15 lesson stays hidden */
  assert.ok(L.visibleSlots(DAY, at("09:50"), { hide: true }).indexOf(0) < 0);
});

test("visibleSlots: nothing is retained while a lesson is running", () => {
  assert.deepEqual(L.visibleSlots(DAY, at("10:30"), { hide: true }),
    [2, 3, 4], "a finished lesson came back during a lesson");
});

test("visibleSlots: nothing is retained before the first bell", () => {
  assert.deepEqual(L.visibleSlots(DAY, at("07:30"), { hide: true }),
    [0, 1, 2, 3, 4]);
});

test("visibleSlots: the last lesson is never hidden early", () => {
  /* 12:45 has passed but the grace has not, so the card must not empty
     out and claim the day is over while the bell is still ringing */
  assert.deepEqual(L.visibleSlots(DAY, at("12:47"), { hide: true, graceMinutes: 5 }),
    [4], "the final lesson vanished inside its own grace period");
});

test("visibleSlots: after the last lesson plus grace, the card empties", () => {
  assert.deepEqual(L.visibleSlots(DAY, at("12:50"), { hide: true, graceMinutes: 5 }), []);
  assert.deepEqual(L.visibleSlots(DAY, at("12:50"), { hide: false, graceMinutes: 5 }), [],
    "show-all mode must hand over to the end-of-day line too");
  assert.deepEqual(L.visibleSlots(DAY, at("12:49"), { hide: false, graceMinutes: 5 }),
    [0, 1, 2, 3, 4], "one minute early is not the end of the day");
});

test("visibleSlots: a card with nothing left retains nothing", () => {
  /* the retained lesson must never be the ONLY thing a pupil sees */
  const one = [{ start: "08:15", end: "09:00" }];
  assert.deepEqual(L.visibleSlots(one, at("09:03"), { hide: true, graceMinutes: 5 }),
    [0], "the last lesson is protected by grace, not by retention");
  assert.deepEqual(L.visibleSlots(one, at("09:03"), { hide: true }), [],
    "with no grace the day is simply over, and nothing is retained");
  /* two lessons, both finished, still inside the grace: the survivor is
     the last one — and it is NOT joined by a retained neighbour */
  const two = [{ start: "08:15", end: "09:00" }, { start: "09:00", end: "09:45" }];
  assert.deepEqual(L.visibleSlots(two, at("09:47"), { hide: true, graceMinutes: 5 }),
    [1], "a finished lesson was retained on a card with nothing to come");
});

test("visibleSlots: an empty card stays empty", () => {
  assert.deepEqual(L.visibleSlots([], at("10:00"), { hide: true }), []);
  assert.deepEqual(L.visibleSlots(null, at("10:00"), {}), []);
});

/* ---------- the break marker's own state machine ---------- */
test("breakSeam: draws between the two lessons a break sits in", () => {
  const seam = L.breakSeam(DAY, at("09:50"));
  assert.deepEqual(seam, { prev: 1, next: 2 });
});

test("breakSeam: nothing while a lesson is running", () => {
  assert.equal(L.breakSeam(DAY, at("10:30")), null);
  assert.equal(L.breakSeam(DAY, at("08:15")), null, "the very first minute");
  assert.equal(L.breakSeam(DAY, at("09:44")), null, "the last minute of a lesson");
});

test("breakSeam: nothing before the first lesson or after the last", () => {
  assert.equal(L.breakSeam(DAY, at("07:30")), null);
  assert.equal(L.breakSeam(DAY, at("13:00")), null);
});

test("breakSeam: nothing unless BOTH neighbours are on the card", () => {
  /* this is what makes hide-mode's retention load-bearing rather than
     cosmetic: drop the finished lesson and the marker correctly refuses */
  const upcomingOnly = DAY.slice(2);
  assert.equal(L.breakSeam(upcomingOnly, at("09:50")), null);
  const finishedOnly = DAY.slice(0, 2);
  assert.equal(L.breakSeam(finishedOnly, at("09:50")), null);
});

test("breakSeam and visibleSlots agree: hide-mode draws the marker in a break", () => {
  const shown = L.visibleSlots(DAY, at("09:50"), { hide: true }).map((i) => DAY[i]);
  const seam = L.breakSeam(shown, at("09:50"));
  assert.ok(seam, "hide-mode went silent about being on a break");
  assert.equal(shown[seam.prev].end, "09:45");
  assert.equal(shown[seam.next].start, "10:10");
});

/* ==================================================================
   PAGING — whole periods only, never half a concurrent group
   ================================================================== */
/* Boxes as the DOM would measure them: a slot per period, its height a
   function of how many concurrent classes it holds, --sgap between. */
const ROW = 26, ROWM = 24.5, SGAP = 10;
function boxesFor(groups) {
  let top = 0;
  return groups.map((n) => {
    const height = n > 1 ? n * ROWM : ROW;
    const b = { top, height, lines: n };
    top += height + SGAP;
    return b;
  });
}
/* every page boundary must fall between two slots */
function assertWholeGroups(boxes, pages, where) {
  const covered = [];
  pages.forEach(([a, b]) => {
    assert.ok(Number.isInteger(a) && Number.isInteger(b),
      where + ": a page boundary is not a slot index");
    for (let i = a; i <= b; i++) covered.push(i);
  });
  assert.deepEqual(covered, boxes.map((_, i) => i),
    where + ": pages do not tile the slots exactly once");
}

test("packPages: everything on one page when it fits", () => {
  const b = boxesFor([1, 1, 1]);
  assert.deepEqual(L.packPages(b, 1000, -1), [[0, 2]]);
});

test("packPages: fills greedily and never splits a concurrent group", () => {
  const groups = [1, 3, 1, 4, 2, 1, 3, 1, 1, 2];
  const b = boxesFor(groups);
  const pages = L.packPages(b, 200, -1);
  assert.ok(pages.length > 1, "this fixture is supposed to overflow");
  assertWholeGroups(b, pages, "packPages");
  /* no page is taller than the pane, unless one slot alone is */
  pages.forEach(([a, z]) => {
    const h = b[z].top + b[z].height - b[a].top;
    assert.ok(h <= 200 || a === z,
      `page ${a}-${z} is ${h}px in a ${200}px pane`);
  });
});

test("packPages: a group taller than the pane gets a page to itself, whole", () => {
  const b = boxesFor([1, 4, 1]);
  const pages = L.packPages(b, 60, -1);
  assertWholeGroups(b, pages, "oversized group");
  const four = pages.find(([a, z]) => a <= 1 && z >= 1);
  assert.deepEqual(four, [1, 1],
    "the 4-way group was packed with a neighbour it cannot fit beside");
});

test("packPages: MUTATION — a row-counting packer really does split groups", () => {
  /* The guarantee is structural: the unit packed is the whole slot. This
     proves the test would catch a regression to the arithmetic the board
     shipped before (perPage = floor(paneH / rowHeight), which counts
     LINES and knows nothing about which lines belong together). */
  const groups = [1, 3, 1, 4, 2, 1, 3, 1, 1, 2];
  const b = boxesFor(groups);
  const paneH = 200;

  function mutantRowPacker() {
    const perPage = Math.max(1, Math.floor(paneH / ROW));
    const lines = [];
    groups.forEach((n, gi) => { for (let k = 0; k < n; k++) lines.push(gi); });
    const out = [];
    for (let i = 0; i < lines.length; i += perPage) {
      out.push(lines.slice(i, i + perPage));
    }
    return out;
  }
  const mutant = mutantRowPacker();
  const split = mutant.some((page, k) => {
    if (k === mutant.length - 1) return false;
    return page[page.length - 1] === mutant[k + 1][0];   /* group straddles */
  });
  assert.ok(split,
    "the mutant packer did not split a group, so this fixture proves nothing");

  /* the real packer, same data, same pane */
  assertWholeGroups(b, L.packPages(b, paneH, -1), "real packer vs mutant");
});

test("packPages: MUTATION — every pane height from 30 to 400 keeps groups whole", () => {
  const groups = [1, 3, 1, 4, 2, 1, 3, 1, 1, 2, 4, 1, 2, 3];
  const b = boxesFor(groups);
  for (let h = 30; h <= 400; h += 1) {
    assertWholeGroups(b, L.packPages(b, h, -1), "paneH " + h);
  }
});

test("packPages: no page starts on the slot after the break", () => {
  const groups = [1, 1, 3, 1, 2, 1, 1, 3, 1];
  const b = boxesFor(groups);
  for (let h = 60; h <= 300; h += 1) {
    for (let avoid = 1; avoid < groups.length; avoid++) {
      const pages = L.packPages(b, h, avoid);
      assertWholeGroups(b, pages, `avoid ${avoid} at ${h}`);
      const starts = pages.map((p) => p[0]).slice(1);
      /* the avoidance is best-effort: it cannot be honoured when the
         previous page would be left with nothing. What must ALWAYS hold
         is that the pages still tile whole slots — checked above. */
      if (starts.indexOf(avoid) >= 0) {
        assert.ok(avoid <= 1 || pages.some((p) => p[1] === avoid - 1 && p[0] === avoid - 1),
          `avoid ${avoid} at ${h}: page started on the seam with room to spare`);
      }
    }
  }
});

test("pageWindows: the last page anchors back to a whole period", () => {
  const b = boxesFor([1, 1, 1, 1, 1, 1, 1, 1]);
  const wins = L.pageWindows(b, 110, -1);
  assert.ok(wins.length > 1);
  const last = wins[wins.length - 1];
  /* it starts on a slot's own top edge, never on an arbitrary pixel */
  assert.ok(b.some((x) => x.top === last.top),
    "the last page starts mid-period");
  /* and it ends flush with the final lesson */
  const bottom = b[b.length - 1].top + b[b.length - 1].height;
  assert.equal(last.top + last.height, Math.round(bottom));
});

test("pageWindows: pages tile the content and each is a real slot range", () => {
  const b = boxesFor([2, 1, 3, 1, 1, 4, 1, 2]);
  const wins = L.pageWindows(b, 150, -1);
  wins.forEach((w) => {
    assert.ok(b.some((x) => x.top === w.top), "a page starts mid-period");
    assert.ok(w.height > 0);
    assert.ok(w.start <= w.end);
  });
  assert.equal(wins[0].start, 0, "the first page does not start at the top");
  assert.equal(wins[wins.length - 1].end, b.length - 1,
    "the last page does not reach the last period");
});

test("pageWindows: empty input is empty, not a crash", () => {
  assert.deepEqual(L.pageWindows([], 100, -1), []);
  assert.deepEqual(L.packPages([], 100, -1), []);
});

/* ==================================================================
   THE KIOSK URL — the six-tab fragment, and the old one it replaces
   ================================================================== */
test("parseSheetFragment: s= carries the six per-grade schedule tabs", () => {
  const f = L.parseSheetFragment(
    `#d=1AbC_dEf-123&g=10,11,12,13,14&s=20,21,22,23,24,25`);
  assert.equal(f.schedules.length, 6);
  f.schedules.forEach((u, i) => assert.ok(u.indexOf("gid=" + (20 + i)) > 0,
    "grade tab " + i + " points at the wrong gid: " + u));
  assert.ok(f.schedules[0].indexOf("1AbC_dEf-123") > 0);
});

test("parseSheetFragment: the new URL keeps every old key working", () => {
  /* This is the whole point of putting the six gids in their own key:
     the board on the wall runs the OLD code until it is repointed, and
     that code must still find its four tabs in g= if it is handed the
     new URL. */
  const f = L.parseSheetFragment(
    `#t=${TOKEN}&g=1,2,3,4,5&s=20,21,22,23,24,25`);
  assert.ok(f.schedule.indexOf("gid=1") > 0, "the legacy schedule gid moved");
  assert.ok(f.exams.indexOf("gid=2") > 0);
  assert.ok(f.events.indexOf("gid=3") > 0);
  assert.ok(f.messages.indexOf("gid=4") > 0);
  assert.ok(f.settings.indexOf("gid=5") > 0);
});

test("parseSheetFragment: an OLD url still parses, with no schedules", () => {
  const f = L.parseSheetFragment(`#t=${TOKEN}&g=1,2,3,4,5`);
  assert.equal(f.schedules, undefined,
    "an old kiosk URL must fall back to the single schedule tab");
  assert.ok(f.schedule.indexOf("gid=1") > 0);
});

test("parseSheetFragment: a malformed s= is IGNORED, never demo mode", () => {
  /* Returning null here would drop the board to bundled sample data — a
     fake school day that looks entirely real. Falling back to the legacy
     tab shows the school's own data and leaves the fault visible.

     That fallback is now a DEAD tab (the six-tab migration replaced it
     and its gid answers HTTP 400), so "ignored" must never mean
     "silent": every one of these also has to reach the console. */
  [ "s=20,21,22", "s=20,21,22,23,24,25,26", "s=20,21,22,23,24,abc",
    "s=", "s=,,,,," ].forEach((bad) => {
    let f;
    const errs = captureErrors(() => {
      f = L.parseSheetFragment(`#t=${TOKEN}&g=1,2,3,4,5&${bad}`);
    });
    assert.ok(f, bad + " sent the board to demo mode");
    assert.equal(f.schedules, undefined, bad + " was accepted");
    assert.ok(f.schedule.indexOf("gid=1") > 0, bad + " lost the legacy tab");
    /* "s=" and "s=,,,,," carry no gids at all — indistinguishable from a
       URL that never had the key, so they stay quiet on purpose. */
    const expected = /^s=,*$/.test(bad) ? 0 : 1;
    assert.equal(errs.length, expected, bad + " logged " + errs.length);
  });
});

test("parseSheetFragment: s= works with a publish token as well as a doc id", () => {
  const f = L.parseSheetFragment(`#t=${TOKEN}&g=1,2,3,4&s=20,21,22,23,24,25`);
  assert.equal(f.schedules.length, 6);
  f.schedules.forEach((u) => assert.ok(u.indexOf("/d/e/" + TOKEN + "/pub?") > 0,
    "a token URL was built in the doc-id shape: " + u));
});

test("parseSheetFragment: s= does not rescue a fragment that is broken anyway", () => {
  assert.equal(L.parseSheetFragment("#g=1,2,3,4&s=20,21,22,23,24,25"), null,
    "no token and no doc id must still be null");
  assert.equal(L.parseSheetFragment(`#t=${TOKEN}&g=1,2&s=20,21,22,23,24,25`), null,
    "too few g= gids must still be null");
});
/* ---------- the "now" highlight must not move anything ----------------
   The running period is meant to differ from every other period by its
   TINT and its accent bar, and by nothing else. It did not: the header's
   clock wrapper is `<div class="now">`, its rule was written bare as
   `.now { … gap: 24px … }`, and that selector also matched `.slot.now` —
   the running period in every grade card. `.slot` re-declares
   `column-gap`, so the leak was invisible along that axis, but nothing
   re-declared the ROW gap, so the concurrent classes of a running split
   period were pushed 24px apart.

   Measured in headless Chrome on the demo board at 09:10, with the
   09:00-09:45 period running: כיתה י"ב's three-way split rendered at a
   48.5px line pitch and 122px tall, against 24.5px and 74px for the
   identical block at 12:00 — the same block, the same grade, one state
   apart. That inflated pitch destroys the design's only cue for
   concurrency (rows that touch, against --sgap between periods) exactly
   when a pupil is looking for the current lesson, and because the page
   packer measures offsetHeight, a slot that changes height when the
   clock crosses its start time also moves the page boundaries under it.

   This is pure CSS, so there is no DOM here to assert against. What CAN
   be pinned is the two properties of the stylesheet that make the leak
   impossible, and both of them fail this test if reverted. The pixel
   evidence lives in the commit message.  ------------------------------ */
const CSS_SRC = fs.readFileSync(
  path.join(__dirname, "..", "dashboard", "style.css"), "utf8");

/* every comma-separated selector in the file, comments stripped */
function cssSelectors(src) {
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  let buf = "";
  for (const ch of clean) {
    if (ch === "{") { out.push(buf); buf = ""; }
    else if (ch === "}") { buf = ""; }
    else buf += ch;
  }
  return out.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
}

test("no rule matches a bare .now — the header's clock cannot reach .slot.now", () => {
  const sels = cssSelectors(CSS_SRC);
  /* the guard is only meaningful if the two rules it is about still
     exist, so prove that first — otherwise a rename makes this vacuous */
  assert.ok(sels.some((s) => /(^|\s)header\s+\.now$/.test(s)),
    "the header's clock-wrapper rule is gone or no longer scoped to header");
  assert.ok(sels.some((s) => s.indexOf(".slot.now") >= 0),
    "the running-period rule .slot.now is gone");
  const bare = sels.filter((s) => s === ".now");
  assert.deepEqual(bare, [],
    "a bare `.now` selector is back: it matches the header's clock wrapper " +
    "AND every .slot.now, and its `gap` reaches the running period's rows");
});

test(".slot pins BOTH gap axes, so no rule can open its group's row pitch", () => {
  const block = /\n\s*\.slot\s*\{([\s\S]*?)\}/.exec(
    CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, ""));
  assert.ok(block, ".slot rule not found in style.css");
  const body = block[1];
  /* `gap: 0 8px` or an explicit `row-gap: 0` — either states the row
     axis. `column-gap` alone is what let the header's gap through. */
  const rowPinned = /(^|;)\s*gap\s*:\s*0(px)?\s+[^;]*;/.test(body) ||
                    /(^|;)\s*row-gap\s*:\s*0(px)?\s*;/.test(body);
  assert.ok(rowPinned,
    ".slot declares no row gap, so its concurrent lines' pitch is at the " +
    "mercy of any other rule that happens to match a slot");
});

/* ---------- setup.gs: does it harm data? (see setup-safety.js) ---------- */
require("./setup-safety.js").run(test);

/* ---------- summary ---------- */
if (process.exitCode) {
  console.error(`\n${passed} passed, some FAILED`);
} else {
  console.log(`✓ all ${passed} tests passed`);
}
