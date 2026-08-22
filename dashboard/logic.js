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

  /* Schedule: columns are Day, Period, Start, End, then one column per
     grade — so the grade list is whatever the school put in the header. */
  function buildSchedule(rows, fields) {
    var grades = (fields || []).slice(4).map(txt).filter(Boolean);
    var byDay = {};
    (rows || []).forEach(function (r) {
      var day = txt(r.Day);
      if (!day || !validTime(r.Start) || !validTime(r.End)) return;
      var subjects = {};
      grades.forEach(function (g) { subjects[g] = txt(r[g]); });
      (byDay[day] = byDay[day] || []).push({
        period: txt(r.Period),
        start: txt(r.Start),
        end: txt(r.End),
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
      if (parseSheetDate(r.Date) !== todayKey) return;
      if (!validTime(r.Start) || !validTime(r.End)) return;
      if (!txt(r.Subject) || !txt(r.Grade)) return;
      out.push({
        kind: "exam",
        grade: txt(r.Grade),
        subject: txt(r.Subject),
        start: txt(r.Start),
        end: txt(r.End),
        room: txt(r.Room)
      });
    });
    (eventRows || []).forEach(function (r) {
      if (parseSheetDate(r.Date) !== todayKey) return;
      if (!validTime(r.Start) || !validTime(r.End)) return;
      if (!txt(r.Title)) return;
      var grades = txt(r.Grades).split(",").map(txt).filter(Boolean);
      out.push({
        kind: "event",
        grades: grades,
        title: txt(r.Title),
        start: txt(r.Start),
        end: txt(r.End),
        room: txt(r.Location)
      });
    });
    out.sort(function (a, b) { return minutes(a.start) - minutes(b.start); });
    return out;
  }

  /* Messages: active, in-range rows split into the three channels. */
  function buildMessages(rows, todayKey) {
    var out = { normal: [], urgent: [], videos: [] };
    (rows || []).forEach(function (r) {
      if (!isActive(r.Active)) return;
      if (!inRange(r.From, r.Until, todayKey)) return;
      var type = normalizeType(r.Type);
      if (!type) return;
      if (type === "video") {
        var url = txt(r.VideoURL);
        if (!url) return;
        var sound = /#sound$/i.test(url);
        out.videos.push({ url: url.replace(/#sound$/i, ""), sound: sound });
      } else {
        var text = txt(r.Text);
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
