/* ==================================================================
   logic.js — pure functions, no DOM, no network.

   Loaded two ways:
     • in the browser as a plain <script> (defines globals)
     • in Node by tests/run.js via require()
   Keeping this file DOM-free is what makes it testable.
   ================================================================== */
(function (root) {
  "use strict";

  /* ---------- Hebrew numerals (gematria) ----------
     Intl computes the hebrew-calendar day/month/year, but ECMA-402
     cannot render the algorithmic "hebr" numbering system (it silently
     falls back to digits) — so we convert the numbers ourselves. */
  var GERESH = "׳", GERSHAYIM = "״";

  function toGematria(n) {
    var ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
    var tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
    var hundreds = ["", "ק", "ר", "ש", "ת"];
    var s = "";
    while (n >= 500) { s += "ת"; n -= 400; }
    s += hundreds[Math.floor(n / 100)];
    n %= 100;
    if (n === 15) s += "טו";        /* not יה — part of the divine name */
    else if (n === 16) s += "טז";   /* not יו — same reason */
    else s += tens[Math.floor(n / 10)] + ones[n % 10];
    return s.length === 1 ? s + GERESH
                          : s.slice(0, -1) + GERSHAYIM + s.slice(-1);
  }

  function hebrewDate(d) {
    var parts = new Intl.DateTimeFormat("he-u-ca-hebrew",
      { day: "numeric", month: "long", year: "numeric" }).formatToParts(d);
    function get(type) {
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === type) return parts[i].value;
      }
      return "";
    }
    return toGematria(+get("day")) + " " + get("month") + " " +
           toGematria(+get("year") % 1000);
  }

  /* ---------- time & dates ---------- */
  function minutes(hhmm) {
    var p = String(hhmm).split(":");
    return (+p[0]) * 60 + (+p[1]);
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* local-date key; never use toISOString() here — that shifts to UTC
     and can report yesterday for evening times in Israel */
  function dateKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /* Accepts YYYY-MM-DD, D/M/YYYY and D.M.YYYY (Sheets' Hebrew locale
     default), returns a normalized YYYY-MM-DD key or null. */
  function parseSheetDate(s) {
    if (!s) return null;
    s = String(s).trim();
    var iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (iso) return iso[1] + "-" + pad(+iso[2]) + "-" + pad(+iso[3]);
    var dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
    if (dmy) return dmy[3] + "-" + pad(+dmy[2]) + "-" + pad(+dmy[1]);
    return null;
  }

  var DAY_LETTERS = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];
  function dayLetter(d) { return DAY_LETTERS[d.getDay()]; }

  /* ---------- wall-clock time in a named timezone ----------
     The board must show Israeli wall-clock time and switch with daylight
     saving on its own. Two things could go wrong if we just used the
     machine's local time: a Pi whose timezone was never set (Raspberry Pi
     OS ships as UTC) would be off by 2-3 hours, and any hard-coded offset
     would break twice a year.

     zonedNow() takes the real instant, asks Intl what the wall clock reads
     in the configured zone, and returns a Date whose LOCAL fields carry
     those values — so getHours(), getDay() and dateKey() are all correct
     and consistent. DST comes from the IANA timezone database, which is
     maintained by the OS and the browser, so nothing here needs updating
     when the switch dates change.

     `base` is injectable so this is testable with a fixed instant. */
  function zonedNow(tz, base) {
    var now = base || new Date();
    if (!tz) return now;
    var parts;
    try {
      parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz, hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      }).formatToParts(now);
    } catch (e) {
      return now;               /* unknown zone name → machine local time */
    }
    var v = {};
    parts.forEach(function (p) { if (p.type !== "literal") v[p.type] = p.value; });
    /* hour can come back as "24" at midnight in some engines */
    var hour = +v.hour % 24;
    return new Date(+v.year, +v.month - 1, +v.day, hour, +v.minute, +v.second);
  }

  /* ---------- sheet field semantics ---------- */
  /* Inclusive on both ends; an empty bound means "unbounded". */
  function inRange(fromStr, untilStr, todayKey) {
    var from = parseSheetDate(fromStr);
    var until = parseSheetDate(untilStr);
    if (from && todayKey < from) return false;
    if (until && todayKey > until) return false;
    return true;
  }

  function isActive(s) {
    var v = String(s || "").trim().toLowerCase();
    return v === "כן" || v === "yes" || v === "true";
  }

  var TYPES = {
    "רגילה": "normal", "normal": "normal",
    "דחופה": "urgent", "urgent": "urgent",
    "וידאו": "video",  "video": "video"
  };
  function normalizeType(s) {
    return TYPES[String(s || "").trim().toLowerCase()] || null;
  }

  /* ---------- HTML escaping ----------
     Sheet content is written by school staff and injected as HTML, so
     everything user-authored goes through this. */
  var ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;",
                  '"': "&quot;", "'": "&#39;" };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ESCAPES[c];
    });
  }

  /* ==================================================================
     Model builders — turn parsed CSV rows into what the board renders.

     House rule: one bad row must never blank the board. Every builder
     validates per row and silently drops what it cannot use.
     ================================================================== */
  var TIME_RE = /^\d{1,2}:\d{2}$/;
  function validTime(s) { return TIME_RE.test(String(s || "").trim()); }
  function txt(v) { return String(v == null ? "" : v).trim(); }

  /* Column headers are Hebrew in the real sheet (the principal edits it,
     so it should read like Hebrew). English names stay accepted as
     aliases so an English-headed sheet — or an older one — still works. */
  var ALIASES = {
    day:      ["יום", "Day"],
    period:   ["שיעור", "Period"],
    start:    ["התחלה", "Start"],
    end:      ["סיום", "End"],
    date:     ["תאריך", "Date"],
    grade:    ["שכבה", "Grade"],
    grades:   ["שכבות", "Grades"],
    subject:  ["מקצוע", "Subject"],
    title:    ["כותרת", "Title"],
    place:    ["מקום", "חדר", "Location", "Room"],
    text:     ["הודעה", "Text"],
    type:     ["סוג", "Type"],
    videoUrl: ["קישור", "VideoURL"],
    from:     ["מתאריך", "From"],
    until:    ["עד תאריך", "Until"],
    active:   ["פעיל", "Active"]
  };

  /* Sheet text is written by school staff, so it can contain anything:
     quotes, commas, emoji, newlines from Alt+Enter, angle brackets.
     clean() makes any cell safe to lay out on one line:
       • newlines/tabs/repeated spaces collapse to single spaces
       • Unicode bidi OVERRIDE and EMBEDDING controls are removed —
         an unterminated one would scramble the rest of the board's
         layout (the "Trojan Source" trick). Plain RLM/LRM marks are
         kept: they are harmless and occasionally intentional.
     HTML-escaping happens separately, in esc(). */
  var BIDI_CONTROLS = /[‪-‮⁦-⁩]/g;
  function clean(v) {
    return String(v == null ? "" : v)
      .replace(BIDI_CONTROLS, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* first non-empty value among a field's accepted header names */
  function pick(row, key) {
    var names = ALIASES[key];
    for (var i = 0; i < names.length; i++) {
      var v = row[names[i]];
      if (v !== undefined && v !== null && clean(v) !== "") return clean(v);
    }
    return "";
  }

  /* how many leading columns are fixed before the grade columns start */
  var SCHEDULE_FIXED_COLS = 4;

  /* Schedule: columns are Day, Period, Start, End, then one column per
     grade — so the grade list is whatever the school put in the header. */
  function buildSchedule(rows, fields) {
    var grades = (fields || []).slice(SCHEDULE_FIXED_COLS).map(txt).filter(Boolean);
    var byDay = {};
    (rows || []).forEach(function (r) {
      var day = pick(r, "day");
      var start = pick(r, "start"), end = pick(r, "end");
      if (!day || !validTime(start) || !validTime(end)) return;
      var subjects = {};
      grades.forEach(function (g) { subjects[g] = clean(r[g]); });
      (byDay[day] = byDay[day] || []).push({
        period: pick(r, "period"),
        start: start,
        end: end,
        subjects: subjects
      });
    });
    Object.keys(byDay).forEach(function (d) {
      byDay[d].sort(function (a, b) { return minutes(a.start) - minutes(b.start); });
    });
    return { grades: grades, byDay: byDay };
  }

  /* Exams + events for today, merged and sorted by start time. */
  function buildAgenda(examRows, eventRows, todayKey) {
    var out = [];
    (examRows || []).forEach(function (r) {
      var start = pick(r, "start"), end = pick(r, "end");
      if (parseSheetDate(pick(r, "date")) !== todayKey) return;
      if (!validTime(start) || !validTime(end)) return;
      if (!pick(r, "subject") || !pick(r, "grade")) return;
      out.push({
        kind: "exam",
        grade: pick(r, "grade"),
        subject: pick(r, "subject"),
        start: start,
        end: end,
        room: pick(r, "place")
      });
    });
    (eventRows || []).forEach(function (r) {
      var start = pick(r, "start"), end = pick(r, "end");
      if (parseSheetDate(pick(r, "date")) !== todayKey) return;
      if (!validTime(start) || !validTime(end)) return;
      if (!pick(r, "title")) return;
      out.push({
        kind: "event",
        grades: pick(r, "grades").split(",").map(clean).filter(Boolean),
        title: pick(r, "title"),
        start: start,
        end: end,
        room: pick(r, "place")
      });
    });
    out.sort(function (a, b) { return minutes(a.start) - minutes(b.start); });
    return out;
  }

  /* Messages: active, in-range rows split into the three channels. */
  function buildMessages(rows, todayKey) {
    var out = { normal: [], urgent: [], videos: [] };
    (rows || []).forEach(function (r) {
      if (!isActive(pick(r, "active"))) return;
      if (!inRange(pick(r, "from"), pick(r, "until"), todayKey)) return;
      var type = normalizeType(pick(r, "type"));
      if (!type) return;
      if (type === "video") {
        var url = pick(r, "videoUrl");
        if (!url) return;
        var sound = /#sound$/i.test(url);
        out.videos.push({ url: url.replace(/#sound$/i, ""), sound: sound });
      } else {
        var text = pick(r, "text");
        if (!text) return;
        out[type].push(text);
      }
    });
    return out;
  }

  /* Video pacing: play at most once per interval. A timestamp in the
     future (clock corrected backwards, e.g. after NTP sync on a Pi
     with no RTC) must not lock playback out for hours. */
  function shouldPlayVideo(lastPlayedMs, nowMs, intervalMin) {
    if (!lastPlayedMs) return true;
    if (lastPlayedMs > nowMs) return true;
    return nowMs - lastPlayedMs >= intervalMin * 60000;
  }

  var api = {
    clean: clean,
    shouldPlayVideo: shouldPlayVideo,
    buildSchedule: buildSchedule,
    buildAgenda: buildAgenda,
    buildMessages: buildMessages,
    toGematria: toGematria,
    hebrewDate: hebrewDate,
    minutes: minutes,
    dateKey: dateKey,
    parseSheetDate: parseSheetDate,
    dayLetter: dayLetter,
    zonedNow: zonedNow,
    inRange: inRange,
    isActive: isActive,
    normalizeType: normalizeType,
    esc: esc
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;            /* Node (tests) */
  } else {
    for (var k in api) root[k] = api[k];   /* browser globals */
    root.DashLogic = api;
  }
})(typeof self !== "undefined" ? self : this);
