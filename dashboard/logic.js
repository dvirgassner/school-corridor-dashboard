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

  /* A Google Sheets checkbox exports as TRUE/FALSE. Accept the obvious
     hand-typed equivalents too, so a column of ✓ or כן still works. */
  function isChecked(v) {
    var s = String(v == null ? "" : v).trim().toLowerCase();
    return s === "true" || s === "כן" || s === "yes" ||
           s === "v" || s === "x" || s === "✓" || s === "✔" || s === "1";
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
    setting:  ["הגדרה", "Setting"],
    value:    ["ערך", "Value"],
    type:     ["סוג", "Type"],
    /* the real header is long ("קישור לוידאו (Google Drive או YouTube)"),
       so this field is matched by PREFIX as well — see pickPrefix() */
    videoUrl: ["קישור", "VideoURL"],
    sound:    ["סאונד", "קול", "Sound"],
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

  /* Some headers carry an explanation in the text itself, e.g.
     "קישור לוידאו (Google Drive או YouTube)". Matching on the leading
     word keeps the parser working when that wording is reworded. */
  function pickPrefix(row, prefix) {
    for (var k in row) {
      if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
      if (clean(k).indexOf(prefix) === 0) {
        var v = clean(row[k]);
        if (v) return v;
      }
    }
    return "";
  }

  /* how many leading columns are fixed before the grade columns start */
  var SCHEDULE_FIXED_COLS = 4;

  /* the events tab's "applies to every grade" column */
  var ALL_LABELS = ["כולם", "כל השכבות", "all"];

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

  /* Exams + events for today, merged and sorted by start time.

     `grades` is the grade list from the schedule tab. Events name their
     grades one of two ways, checked in this order:
       1. a checkbox column per grade (what the template builds now —
          Sheets cannot multi-select inside one cell, so a column of
          checkboxes is the native way to tick several grades)
       2. a single comma-separated שכבות cell (the original shape; still
          honoured so an older sheet keeps working) */
  function buildAgenda(examRows, eventRows, todayKey, grades) {
    grades = grades || [];
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
      var ticked = grades.filter(function (g) { return isChecked(r[g]); });
      var listed = pick(r, "grades").split(",").map(clean).filter(Boolean);
      /* a dedicated "כולם" checkbox beats ticking every grade one by one,
         and reads as one chip on the board */
      var all = ALL_LABELS.some(function (k) { return isChecked(r[k]); }) ||
                listed.some(function (v) {
                  return ALL_LABELS.indexOf(v) >= 0;
                });
      out.push({
        kind: "event",
        all: all,
        grades: ticked.length ? ticked : listed.filter(function (v) {
          return ALL_LABELS.indexOf(v) < 0;
        }),
        title: pick(r, "title"),
        start: start,
        end: end,
        room: pick(r, "place")
      });
    });
    out.sort(function (a, b) { return minutes(a.start) - minutes(b.start); });
    return out;
  }

  /* ---------- video links ----------
     The office will paste whatever link they have, so accept the three
     shapes that actually turn up and normalise them:

       YouTube  → played through YouTube's official embed. No download,
                  no yt-dlp: downloading breaks YouTube's terms and would
                  put a self-updating scraper on a school device, which
                  is the opposite of this project's maintenance story.
       Drive    → rewritten to its direct-download form; a normal Drive
                  share link points at a viewer PAGE, which a <video>
                  element cannot play.
       anything → treated as a direct media file URL.

     `wantSound` comes from the sheet's סאונד column (כן/לא); the legacy
     "#sound" URL suffix still works but nobody has to know about it.

     Returns null for an empty/unusable value. */
  function normalizeVideo(raw, wantSound) {
    var url = clean(raw);
    if (!url) return null;
    var sound = wantSound === true || /#sound$/i.test(url);
    url = url.replace(/#sound$/i, "");

    var yt = url.match(
      /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    if (yt) return { kind: "youtube", id: yt[1], sound: sound };

    var dr = url.match(
      /drive\.google\.com\/(?:file\/d\/([A-Za-z0-9_-]{10,})|open\?id=([A-Za-z0-9_-]{10,})|uc\?(?:[^#]*&)?id=([A-Za-z0-9_-]{10,}))/);
    if (dr) {
      var id = dr[1] || dr[2] || dr[3];
      return {
        kind: "file", drive: true, sound: sound,
        src: "https://drive.google.com/uc?export=download&id=" + id
      };
    }

    /* Anything else must look like an actual media file. The principal
       only ever has Drive or YouTube links, so a different URL here is
       almost always a mistake (a Drive FOLDER, or a web page) — better
       to skip it than to hand a web page to a <video> element. */
    if (/^https?:\/\/\S+\.(mp4|webm|m4v|mov)(\?\S*)?$/i.test(url)) {
      return { kind: "file", src: url, sound: sound };
    }
    return null;
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
        var link = pick(r, "videoUrl") || pickPrefix(r, "קישור");
        var clip = normalizeVideo(link, isActive(pick(r, "sound")));
        if (clip) out.videos.push(clip);
      } else {
        var text = pick(r, "text");
        if (!text) return;
        out[type].push(text);
      }
    });
    return out;
  }

  /* ---------- "day of the day" ----------
     Israeli days first, international only as a fallback. Israeli
     entries are keyed by HEBREW month+day so they need no yearly
     maintenance; we ask Intl for the Hebrew date in English month
     spellings, which are stable to match on. */
  function hebrewKey(d) {
    var parts = new Intl.DateTimeFormat("en-u-ca-hebrew",
      { day: "numeric", month: "long" }).formatToParts(d);
    var day = "", month = "";
    parts.forEach(function (p) {
      if (p.type === "day") day = p.value;
      if (p.type === "month") month = p.value;
    });
    return month + "-" + parseInt(day, 10);
  }

  function gregKey(d) {
    return pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /* In a Hebrew leap year the plain "Adar" entries belong in Adar II,
     which is when those observances (Purim, for instance) are kept. */
  function hebKeyMatches(entryKey, todayKey) {
    if (entryKey === todayKey) return true;
    if (todayKey.indexOf("Adar II-") === 0) {
      return entryKey === todayKey.replace("Adar II-", "Adar-");
    }
    return false;
  }

  /* Entries flagged `off` are school vacations. There is nobody in the
     corridor to read the board, so they are skipped rather than shown —
     and skipping means an international day on the same date does not
     get shown either: the school is shut, not observing something else. */
  function dayOfTheDay(d, days) {
    if (!days) return null;
    var hk = hebrewKey(d), gk = gregKey(d), i, e;
    var israeli = days.israeli || [];
    for (i = 0; i < israeli.length; i++) {
      e = israeli[i];
      if ((e.heb && hebKeyMatches(e.heb, hk)) || (e.greg && e.greg === gk)) {
        return e.off ? null : e;
      }
    }
    var intl = days.international || [];
    for (i = 0; i < intl.length; i++) {
      if (intl[i].greg === gk) return intl[i].off ? null : intl[i];
    }
    return null;
  }

  /* ---------- status / error indicator ----------
     The board is unattended, so a fault has to be visible on the screen
     itself: the principal reads this line and reports it. Only one
     message shows at a time, most fundamental cause first — "no
     internet" explains both other failures, so it wins.

     `pageHost` is whether the machine can still reach the site the board
     was served from (GitHub Pages); `sheets` is whether the last data
     fetch succeeded. Either can fail alone. */
  function statusMessage(s) {
    s = s || {};
    if (s.online === false) return "אין אינטרנט";
    if (s.pageHost === false && s.sheets === false) return "אין אינטרנט";
    if (s.sheets === false) return "מנותק מגוגל שיטס";
    if (s.pageHost === false) return "מנותק מגיטהאב";
    return null;
  }

  /* ---------- settings tab ----------
     A simple two-column key/value tab, so the principal can change
     presentation (currently the colour theme) without touching code. */
  /* "צבעונית" was the name before the two variants existed; it still maps
     to צבעוני 1 so an older sheet keeps working. */
  var THEMES = {
    "כהה": "dark", "dark": "dark",
    "בהירה": "light", "light": "light",
    "צבעוני 1": "colorful", "colorful": "colorful", "צבעונית": "colorful",
    "צבעוני 2": "colorful2", "colorful2": "colorful2"
  };

  function buildSettings(rows) {
    var out = { theme: "dark" };
    (rows || []).forEach(function (r) {
      var key = pick(r, "setting"), val = pick(r, "value");
      if (!key || !val) return;
      if (/ערכת נושא|theme/i.test(key)) {
        var t = THEMES[val.toLowerCase()] || THEMES[val];
        if (t) out.theme = t;
      }
    });
    return out;
  }

  /* ---------- sheet location from the URL fragment ----------
     The board is served from a PUBLIC repository, so the sheet's
     publish token must not live in the code. Instead the Pi's kiosk URL
     carries it in the fragment:

       https://user.github.io/repo/dashboard/#t=<token>&g=<gid>,<gid>,<gid>,<gid>
                                              (schedule,exams,events,messages)

     A fragment is never transmitted to the web server — verified against
     a real server, not assumed — so the token stays between the Pi and
     Google. Anyone opening the public URL without a fragment gets demo
     data instead of the school's sheet.

     This is obscurity, not authentication: whoever holds the token can
     read the sheet. The no-personal-data rule still applies.

     Returns the four CSV URLs, or null if there is no usable fragment
     (bad input falls back to config.js / demo mode rather than fetching
     a malformed URL). */
  function parseSheetFragment(hash) {
    if (!hash) return null;
    var p;
    try { p = new URLSearchParams(String(hash).replace(/^#/, "")); }
    catch (e) { return null; }
    /* Two ways to name the sheet, both verified to allow cross-origin
       reads (many other Google CSV endpoints do NOT — /gviz/tq sends no
       CORS header at all, so it works in curl and fails in a browser):

         #t=<publishToken>  the "Publish to web" token; each tab has to
                            be published separately
         #d=<documentId>    the plain document id; needs only ONE setting
                            ("anyone with the link can view"), which is
                            considerably less clicking

       Both are public-by-URL, so the no-personal-data rule applies
       either way. */
    var token = (p.get("t") || "").trim();
    var docId = (p.get("d") || "").trim();
    var gids = (p.get("g") || "").split(",").map(function (s) {
      return s.trim();
    }).filter(Boolean);
    /* strict validation: these values are interpolated into a URL we
       then fetch, so anything unexpected is rejected outright */
    var useDoc = !token && !!docId;
    if (useDoc) {
      if (!/^[A-Za-z0-9_-]+$/.test(docId)) return null;
    } else {
      if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
    }
    /* 4 gids = the original four tabs; an optional 5th is the settings
       tab (theme). Older kiosk URLs with 4 keep working. */
    if (gids.length !== 4 && gids.length !== 5) return null;
    for (var i = 0; i < gids.length; i++) {
      if (!/^\d+$/.test(gids[i])) return null;
    }
    function url(gid) {
      return useDoc
        ? "https://docs.google.com/spreadsheets/d/" + docId +
          "/export?format=csv&gid=" + gid
        : "https://docs.google.com/spreadsheets/d/e/" + token +
          "/pub?gid=" + gid + "&single=true&output=csv";
    }
    var out = {
      schedule: url(gids[0]),
      exams:    url(gids[1]),
      events:   url(gids[2]),
      messages: url(gids[3])
    };
    if (gids.length === 5) out.settings = url(gids[4]);
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
    statusMessage: statusMessage,
    hebrewKey: hebrewKey,
    dayOfTheDay: dayOfTheDay,
    buildSettings: buildSettings,
    parseSheetFragment: parseSheetFragment,
    clean: clean,
    normalizeVideo: normalizeVideo,
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
    isChecked: isChecked,
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
