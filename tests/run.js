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
test("normalizeVideo: plain mp4 link passes through", () => {
  assert.deepEqual(L.normalizeVideo("https://x/a.mp4"),
    { kind: "file", src: "https://x/a.mp4", sound: false });
});
test("normalizeVideo: #sound opts into audio and is stripped", () => {
  const v = L.normalizeVideo("https://x/a.mp4#sound");
  assert.equal(v.sound, true);
  assert.equal(v.src, "https://x/a.mp4");
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
  const rows = [
    { "הודעה": "שלום", "סוג": "רגילה", "קישור": "", "מתאריך": "", "עד תאריך": "", "פעיל": "כן" },
    { "הודעה": "דחוף", "סוג": "דחופה", "קישור": "", "מתאריך": "", "עד תאריך": "", "פעיל": "כן" },
    { "הודעה": "", "סוג": "וידאו", "קישור": "https://x/y.mp4#sound", "מתאריך": "", "עד תאריך": "", "פעיל": "כן" },
    { "הודעה": "כבוי", "סוג": "רגילה", "קישור": "", "מתאריך": "", "עד תאריך": "", "פעיל": "לא" },
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
  /* 4 tabs, or 5 with the optional settings tab; anything else is a typo */
  assert.equal(L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2`), null);
  assert.equal(L.parseSheetFragment(`#t=${TOKEN}&g=0,1,2,3,4,5`), null);
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
  assert.equal(L.buildSettings([{ "הגדרה": "ערכת נושא", "ערך": "צבעונית" }]).theme, "colorful");
  assert.equal(L.buildSettings([{ "הגדרה": "ערכת נושא", "ערך": "כהה" }]).theme, "dark");
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

test("video URL with query string and #sound is parsed correctly", () => {
  const rows = [{ "הודעה": "", "סוג": "וידאו",
    "קישור": "https://x/y.mp4?token=a&b=c#sound",
    "מתאריך": "", "עד תאריך": "", "פעיל": "כן" }];
  const m = L.buildMessages(rows, TODAY);
  assert.deepEqual(m.videos,
    [{ kind: "file", src: "https://x/y.mp4?token=a&b=c", sound: true }]);
});

/* ---------- summary ---------- */
if (process.exitCode) {
  console.error(`\n${passed} passed, some FAILED`);
} else {
  console.log(`✓ all ${passed} tests passed`);
}
