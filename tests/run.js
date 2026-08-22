/* Test harness for the dashboard's pure logic.
   Run:  node tests/run.js
   No framework — Node's built-in assert only, so there is nothing to
   install and nothing to break. */
const assert = require("assert");
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
test("buildMessages: video rows carry url and sound flag", () => {
  const rows = [
    { Text: "", Type: "וידאו", VideoURL: "https://x/y.mp4#sound", From: "", Until: "", Active: "כן" },
    { Text: "", Type: "וידאו", VideoURL: "https://x/z.mp4", From: "", Until: "", Active: "כן" },
  ];
  const m = L.buildMessages(rows, TODAY);
  assert.deepEqual(m.videos, [
    { url: "https://x/y.mp4", sound: true },
    { url: "https://x/z.mp4", sound: false },
  ]);
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

/* ---------- summary ---------- */
if (process.exitCode) {
  console.error(`\n${passed} passed, some FAILED`);
} else {
  console.log(`✓ all ${passed} tests passed`);
}
