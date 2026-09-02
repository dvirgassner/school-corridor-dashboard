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
    var s = String(hhmm).trim();
    var pm = /[Pp][Mm]\s*$/.test(s), am = /[Aa][Mm]\s*$/.test(s);
    var p = s.replace(/\s*[AaPp][Mm]\s*$/, "").split(":");
    var h = +p[0];
    if (pm && h < 12) h += 12;          /* 1 PM -> 13 */
    if (am && h === 12) h = 0;          /* 12 AM -> 00 */
    return h * 60 + (+p[1]);
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
  /* HH:MM, optionally with seconds, and optionally with an AM/PM suffix.
     The sheet's time columns are real time-of-day values displayed hh:mm,
     and a CSV export carries the DISPLAYED text — so HH:MM is what
     normally arrives. The extra tolerance is deliberate insurance: if a
     sheet is ever left on a 12-hour or seconds-bearing format, the board
     keeps working instead of silently dropping every lesson. */
  var TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?(\s*[AaPp][Mm])?$/;
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
    active:   ["פעיל", "Active"],
    reason:   ["סיבה", "Reason"]
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

  /* Each grade owns two columns in the מערכת tab: its subject, and the
     room that lesson is in. The template heads the second one with the
     grade's own label plus " חדר" — "ז׳ חדר" — so the pair is obvious in
     the sheet and derivable here. A bare "חדר", or the English "Room",
     is accepted as well, for a sheet somebody headed by hand. */
  var ROOM_SUFFIX = " חדר";
  function isRoomHeader(h) {
    h = txt(h);
    if (!h) return false;
    if (h === "חדר" || h.toLowerCase() === "room") return true;
    return h.length > ROOM_SUFFIX.length &&
           h.slice(h.length - ROOM_SUFFIX.length) === ROOM_SUFFIX;
  }

  /* the events tab's "applies to every grade" column */
  var ALL_LABELS = ["כולם", "כל השכבות", "all"];

  /* ---------- matching a grade across tabs ----------
     A grade's name is written by hand in more than one place, and the
     punctuation does not agree. The real sheet has it both ways: the
     per-grade timetable tabs title themselves with an ASCII apostrophe
     ("מערכת שעות לכיתה ז'", U+0027) while the events and closures tabs
     head their tick-box columns with a Hebrew GERESH ("ז׳", U+05F3) —
     characters that look identical on screen and are not equal in code.

     Before the six-tab migration this never showed, because the grade
     list came from the same tab as nothing else. Now it comes from the
     timetable tabs and is matched against columns in two other tabs, so
     a bare === would have quietly stopped every event and every closure
     from finding its grade — a failure with no error and no visible
     cause beyond chips that stopped appearing.

     So a grade column is matched on the LETTERS, ignoring geresh,
     gershayim, straight and curly quotes and spaces. That also means the
     principal can type either form in either tab and be right. */
  var GRADE_MARKS = /[׳״'"‘’“”\s]/g;
  function gradeKey(s) {
    return clean(s).replace(GRADE_MARKS, "");
  }

  /* This grade's cell in a row, whichever way its column is punctuated.
     The exact-hit fast path keeps the common case a single lookup. */
  function gradeCell(row, grade) {
    if (!row) return undefined;
    if (row[grade] !== undefined) return row[grade];
    var want = gradeKey(grade);
    if (!want) return undefined;
    for (var k in row) {
      if (!Object.prototype.hasOwnProperty.call(row, k)) continue;
      if (gradeKey(k) === want) return row[k];
    }
    return undefined;
  }

  /* Schedule: columns are Day, Period, Start, End, then a SUBJECT and a
     ROOM column per grade — so the grade list is whatever the school put
     in the header, minus the room columns that follow each one.

     Two features of the real sheet drive the shape of this function:

       1. THE MERGED יום COLUMN. Sheets exports a merged cell as its
          value on the first row and blanks on the rest, so a blank day
          means "same day as above", not "no day".

       2. CONCURRENT CLASSES. When a period splits into groups — a grade
          divided for languages, five parallel electives in י"ב — the
          principal inserts an extra row directly under the lesson and
          fills in only the splitting grade's subject and room. The
          inserted row's day, period and time cells are locked and
          therefore blank, so it arrives here carrying nothing but the
          extra class. Rows are grouped by DAY + START TIME, and every
          row landing in the same slot contributes to it.

     Each period therefore carries the same information twice:

       subjects[grade]  the first subject in that slot, a plain string —
       rooms[grade]     and its room. This is what app.js renders today,
                        and it must keep working unchanged.
       entries[grade]   every concurrent class in that slot, in sheet
                        order, as { subject, room } objects. Empty array
                        when the grade has no class then. This is the
                        full picture, for the pane redesign to consume.

     Keeping both is deliberate: the sheet's new shape and the board's
     new rendering are separate changes, and this one must not wait for
     the other to land. */
  function buildSchedule(rows, fields) {
    var cols = (fields || []).slice(SCHEDULE_FIXED_COLS).map(txt).filter(Boolean);
    /* a room column belongs to the grade column immediately before it */
    var grades = [], roomCol = {};
    cols.forEach(function (h, i) {
      if (isRoomHeader(h)) return;
      grades.push(h);
      var next = cols[i + 1];
      if (next && isRoomHeader(next)) roomCol[h] = next;
    });

    var byDay = {};
    var slots = {};                    /* "day|start" -> the period object */
    /* What the row above stated, for the cells this row leaves blank: the
       day (a merged cell), and the period and times (locked columns an
       inserted split row cannot carry). */
    var at = { day: "", period: "", start: "", end: "" };

    (rows || []).forEach(function (r) {
      var statedDay = pick(r, "day");
      if (statedDay) at.day = statedDay;
      var start = pick(r, "start"), end = pick(r, "end");

      /* A row with no start time of its own is a split row: it belongs to
         the slot the row above opened. A row that states a time opens a
         new slot and becomes what later blank rows inherit. */
      var split = !validTime(start);
      if (split) {
        start = at.start; end = at.end;
      } else {
        at.start = start;
        at.end = end;
        at.period = pick(r, "period");
      }
      var day = at.day;
      if (!day || !validTime(start) || !validTime(end)) return;

      /* what this row says, grade by grade */
      var here = {}, any = false;
      grades.forEach(function (g) {
        var subject = clean(r[g]);
        var room = roomCol[g] ? clean(r[roomCol[g]]) : "";
        if (!subject && !room) return;
        here[g] = { subject: subject, room: room };
        any = true;
      });
      /* a blank row under a lesson is spacing, not a silent extra class */
      if (split && !any) return;

      var key = day + "|" + start;
      var slot = slots[key];
      if (!slot) {
        slot = { period: at.period, start: start, end: end,
                 subjects: {}, rooms: {}, entries: {} };
        grades.forEach(function (g) {
          slot.subjects[g] = "";
          slot.rooms[g] = "";
          slot.entries[g] = [];
        });
        slots[key] = slot;
        (byDay[day] = byDay[day] || []).push(slot);
      }
      grades.forEach(function (g) {
        var e = here[g];
        if (!e) return;
        slot.entries[g].push(e);
        /* first one wins the single-value view — the pane shows one line
           per grade per period until the redesign lands */
        if (!slot.subjects[g]) {
          slot.subjects[g] = e.subject;
          slot.rooms[g] = e.room;
        }
      });
    });

    Object.keys(byDay).forEach(function (d) {
      byDay[d].sort(function (a, b) { return minutes(a.start) - minutes(b.start); });
    });
    return { grades: grades, byDay: byDay };
  }

  /* ==================================================================
     THE PER-GRADE מערכת TABS  —  the school's real timetable shape.

     buildSchedule() above reads ONE tab holding every grade side by
     side. That is not how the school keeps its timetable: each grade has
     its own tab (מערכת ז … מערכת יב), laid out as a week grid rather
     than a row-per-lesson list. Both parsers stay: the six-tab path is
     what the board now runs on, and the single-tab one is what an older
     kiosk URL — including the one on the wall until the repoint — still
     uses. Removing it would take the live board down the moment this is
     deployed.

     THE GRID, verified against the published CSV of the real tabs:

       row 1   A1 is a title:  מערכת שעות לכיתה ז'
       row 2   the six day letters, each over a MERGED pair of columns —
               so the letter arrives on the FIRST column of its pair and
               the second column is blank:
                 D:E = א   F:G = ב   H:I = ג   J:K = ד   L:M = ה   N:O = ו
       row 3   sub-headers:  B "מ-"  C "עד",  then שיעור / מיקום per pair
       rows 4+ fourteen blocks of FOUR rows each. The block's first row
               carries the period number in A and its times in B and C;
               all four rows can carry a lesson, which is how up to four
               concurrent classes are expressed. In each day pair the
               first column is the lesson text and the second is its room.

     Three things about the real data that this parser has to survive,
     none of them hypothetical — all three are in the fixture:

       · A LESSON WITH NO ROOM.  "חנ""ג בנות (מורה ג)" arrives with an
         empty מיקום cell, because the class is outdoors. It is a real
         lesson and must render.
       · A ROOM WITH NO LESSON.  The mirror case is meaningless, and is
         dropped rather than rendered as a blank line with a pin.
       · A SHORT LAST BLOCK.  Sheets trims trailing empty rows from a CSV
         export, so the final block usually arrives with fewer than four
         rows — and an all-empty block arrives with four blank ones. The
         block boundary is therefore taken from column A holding a period
         number, never from counting rows in fours.

     Blocks are located by content, not by position, so the parser also
     tolerates a tab whose blank rows were dropped by skipEmptyLines, and
     a grid with more or fewer than fourteen periods.
     ================================================================== */
  var GRADE_TAB_FIRST_ROW = 3;      /* 0-based: sheet row 4      */
  var GRADE_TAB_FIRST_COL = 3;      /* 0-based: sheet column D   */
  var GRADE_TAB_DAYS = ["א", "ב", "ג", "ד", "ה", "ו"];

  /* A1 names the grade, and that is where the board's card heading comes
     from — so the six tabs can be renamed or reordered in the sheet
     without a code change. The wording is stripped by PREFIX so
     "מערכת שעות לכיתה" becoming "מערכת שעות לשכבה" does not silently
     leave the whole sentence as the grade name. */
  var GRADE_TITLE_PREFIXES = [
    "מערכת שעות לכיתה", "מערכת שעות לשכבה", "מערכת שעות של",
    "מערכת שעות", "מערכת לכיתה", "מערכת לשכבה", "מערכת"
  ];

  function gradeLabelFromTitle(title) {
    var t = clean(title);
    if (!t) return "";
    for (var i = 0; i < GRADE_TITLE_PREFIXES.length; i++) {
      var pre = GRADE_TITLE_PREFIXES[i];
      if (t.indexOf(pre) === 0) {
        t = clean(t.slice(pre.length));
        break;
      }
    }
    /* A title that is nothing BUT the prefix names no grade. */
    return t;
  }

  /* Row 2, read as the merged-cell export it is: a letter on the first
     column of each pair, a blank on the second. Falls back to the fixed
     א-ו order by position, so a tab whose day row was deleted still
     parses instead of yielding an empty week. */
  function gradeTabDayColumns(row) {
    row = row || [];
    var out = [], c, i = 0;
    for (c = GRADE_TAB_FIRST_COL; c + 1 < Math.max(row.length, GRADE_TAB_FIRST_COL + 12); c += 2) {
      var letter = txt(row[c]);
      if (!letter || GRADE_TAB_DAYS.indexOf(letter) < 0) letter = GRADE_TAB_DAYS[i];
      if (!letter) break;
      out.push({ day: letter, subjectCol: c, roomCol: c + 1 });
      i++;
      if (i >= GRADE_TAB_DAYS.length) break;
    }
    return out;
  }

  /* One grade's tab, as a MATRIX of cells (Papa.parse with header:false)
     rather than named rows: the header names repeat once per day pair, so
     there is nothing to key on.

     Returns { label, byDay }, where byDay[dayLetter] is that day's
     periods in time order:

       { period, start, end, classes: [ { subject, room }, … ] }

     `classes` holds every concurrent class in the period, in sheet order,
     and is never empty — a period with nothing in it produces no entry at
     all rather than an empty one. */
  function parseGradeTab(matrix, fallbackLabel) {
    var rows = matrix || [];
    var label = gradeLabelFromTitle((rows[0] || [])[0]) || clean(fallbackLabel);
    var days = gradeTabDayColumns(rows[1]);
    var byDay = {};
    days.forEach(function (d) { byDay[d.day] = []; });

    var open = null;      /* the block being filled, or null before the first */
    for (var i = GRADE_TAB_FIRST_ROW; i < rows.length; i++) {
      var row = rows[i] || [];
      var period = txt(row[0]), start = txt(row[1]), end = txt(row[2]);
      /* A period number AND two usable times: this row opens a block.
         Requiring all three means a stray number in column A cannot
         invent a period with no times for the board to place. */
      if (/^\d+$/.test(period) && validTime(start) && validTime(end)) {
        open = { period: period, start: start, end: end, slots: {} };
      } else if (!open) {
        continue;         /* rows above the first block: nothing to attach to */
      }
      /* every row of the block, its first included, can carry a lesson */
      for (var k = 0; k < days.length; k++) {
        var d = days[k];
        var subject = clean(row[d.subjectCol]);
        /* A room with no lesson beside it is a leftover, not a class. */
        if (!subject) continue;
        var slot = open.slots[d.day];
        if (!slot) {
          slot = { period: open.period, start: open.start, end: open.end,
                   classes: [] };
          open.slots[d.day] = slot;
          (byDay[d.day] = byDay[d.day] || []).push(slot);
        }
        slot.classes.push({ subject: subject, room: clean(row[d.roomCol]) });
      }
    }

    Object.keys(byDay).forEach(function (d) {
      byDay[d].sort(function (a, b) { return minutes(a.start) - minutes(b.start); });
    });
    return { label: label, byDay: byDay };
  }

  /* Six parsed tabs → the ONE model the board renders, in exactly the
     shape buildSchedule() returns. That is the point of this function:
     the data source changed, the model contract did not, so markUpdates,
     the agenda's grade list, the closures pane and the theme pipeline are
     all untouched by the migration.

     `labels` supplies a fallback name per position. It matters more than
     it looks: a grade whose tab could not be read must still occupy its
     own card in its own accent colour, because dropping it would shift
     every later grade's colour and leave a hole in the grid — the board
     would look like a different school rather than like one tab being
     briefly unreadable. */
  function mergeGradeSchedules(tabs, labels) {
    tabs = tabs || [];
    labels = labels || [];
    var grades = [], byDay = {}, index = {};

    tabs.forEach(function (tab, i) {
      var name = (tab && tab.label) || clean(labels[i]) || ("שכבה " + (i + 1));
      /* Two tabs claiming the same name would collapse into one card and
         silently hide a grade; keep both, distinguished. */
      while (grades.indexOf(name) >= 0) name = name + " ";
      grades.push(name);
    });

    function slotFor(day, p) {
      var key = day + "|" + p.start;
      var slot = index[key];
      if (slot) return slot;
      slot = { period: p.period, start: p.start, end: p.end,
               subjects: {}, rooms: {}, entries: {} };
      grades.forEach(function (g) {
        slot.subjects[g] = "";
        slot.rooms[g] = "";
        slot.entries[g] = [];
      });
      index[key] = slot;
      (byDay[day] = byDay[day] || []).push(slot);
      return slot;
    }

    tabs.forEach(function (tab, i) {
      if (!tab || !tab.byDay) return;
      var g = grades[i];
      Object.keys(tab.byDay).forEach(function (day) {
        tab.byDay[day].forEach(function (p) {
          if (!p.classes || !p.classes.length) return;
          var slot = slotFor(day, p);
          slot.entries[g] = p.classes.slice();
          /* the single-value view every earlier part of the board reads */
          slot.subjects[g] = p.classes[0].subject;
          slot.rooms[g] = p.classes[0].room;
        });
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
      var ticked = grades.filter(function (g) { return isChecked(gradeCell(r, g)); });
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
      /* פעיל and the date range are OPTIONAL columns. A sheet that simply
         lists the messages currently worth showing has none of them, and
         an absent column must not mean "hidden" — that would blank the
         board. Only an explicit "לא" hides a row. */
      var active = pick(r, "active");
      if (active && !isActive(active)) return;
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

  /* Which vacation, if any, covers this date. The ranges come from the
     Ministry of Education's feed via tools/fetch-vacations.js and are
     inclusive at both ends. Comparing YYYY-MM-DD keys as strings is
     exact here — no timezone arithmetic, no Date objects to drift.

     Returns the entry rather than a bare true, so the board can name the
     vacation on screen. A screen that simply goes blank is
     indistinguishable from a broken one, and this board is watched by
     people who cannot tell the difference and have no way to check. */
  function vacationOn(d, list) {
    if (!list || !list.length) return null;
    var k = dateKey(d), i, v;
    for (i = 0; i < list.length; i++) {
      v = list[i];
      if (v && v.from && v.to && k >= v.from && k <= v.to) return v;
    }
    return null;
  }

  /* ---------- ימים ללא לימודים ----------
     Closures the ministry's calendar cannot know about: a school trip, an
     activity off site, a strike. The principal types them into the sheet,
     with the same grade/כולם tick boxes the events tab uses.

     Deliberately NOT merged into vacations.js: that file is regenerated
     from the ministry feed every week, so anything typed there would be
     silently overwritten. The two sources stay apart and are consulted
     separately.

     A blank "עד תאריך" means a single day — the common case, which should
     not cost the principal a second date entry. */
  function buildClosures(rows, grades) {
    grades = grades || [];
    var out = [];
    (rows || []).forEach(function (r) {
      var from = parseSheetDate(pick(r, "from"));
      var reason = pick(r, "reason");
      /* Both are required. A row with a reason and no date is a half-typed
         entry, and guessing a date for it could blank the board on a day
         nobody chose. */
      if (!from || !reason) return;
      var to = parseSheetDate(pick(r, "until")) || from;
      if (to < from) to = from;          /* dates entered backwards */
      var ticked = grades.filter(function (g) { return isChecked(gradeCell(r, g)); });
      /* Ticking every grade one by one means the same thing as כולם. */
      var all = ALL_LABELS.some(function (k) { return isChecked(r[k]); }) ||
                (grades.length > 0 && ticked.length === grades.length);
      out.push({
        from: from,
        to: to,
        reason: reason,
        all: all,
        grades: all ? [] : ticked
      });
    });
    return out;
  }

  /* The closure in force on a date. A whole-school closure wins outright
     over any per-grade one, because the board it produces replaces the
     entire screen rather than a single card.

     Pass a grade to ask "is THIS grade out today"; omit it to ask only
     about the whole school. */
  function closureFor(d, list, grade) {
    var k = dateKey(d), i, c, perGrade = null;
    for (i = 0; i < (list || []).length; i++) {
      c = list[i];
      if (!c || k < c.from || k > c.to) continue;
      if (c.all) return c;
      if (grade && !perGrade && c.grades.indexOf(grade) >= 0) perGrade = c;
    }
    return perGrade;
  }

  /* ---------- status / error indicator ----------
     The board is unattended, so a fault has to be visible on the screen
     itself: the principal reads this line and reports it. Only one
     message shows at a time, most fundamental cause first — "no
     internet" explains both other failures, so it wins.

     `pageHost` is whether the machine can still reach the site the board
     was served from (GitHub Pages); `sheets` is whether the sheet is
     readable. Either can fail alone.

     Each of the three is a THREE-state value: true, false, or null for
     "not known yet / not sure". Only an explicit `false` puts a message
     on the wall, which is what lets sheetsFlag() below hold its tongue
     while a fault is still only a suspicion. */
  function statusMessage(s) {
    s = s || {};
    if (s.online === false) return "אין אינטרנט";
    if (s.pageHost === false && s.sheets === false) return "אין אינטרנט";
    if (s.sheets === false) return "מנותק מגוגל שיטס";
    if (s.pageHost === false) return "מנותק מגיטהאב";
    return null;
  }

  /* Is the sheet connection broken, or did one read just miss?

     The board now reads ELEVEN tabs a minute — six per-grade מערכת tabs
     plus מבחנים, אירועים, הודעות, הגדרות and ימים ללא לימודים. At that
     rate a single failed request is routine, and an indicator that
     announces "מנותק מגוגל שיטס" every time one blips is an indicator
     the school stops believing. It has to mean a PERSISTENT fault.

     So a failure is only reported after `limit` consecutive failing
     refresh cycles — three, i.e. about three minutes at the default
     refreshSeconds. Below that the answer is null, "not sure", which
     statusMessage() renders as no message at all.

     Nothing is hidden by the wait: the עודכן stamp turns amber on its
     own once the data is staleMinutes old, so a real outage is visible
     within ten minutes even if this said nothing, and within three if
     it is genuine. */
  function sheetsFlag(fails, limit) {
    if (!fails) return true;
    return fails >= (limit || 3) ? false : null;
  }

  /* What the indicator's tooltip and the console say about WHICH tabs
     are unhappy.

     "מנותק מגוגל שיטס" on a wall in a school nobody can walk into is not
     a diagnosis — the last incident cost a remote debugging session to
     learn which of eleven requests was failing. Naming the tab turns the
     same indicator into an answer.

     Two different states, deliberately worded apart:
       · `failed`   — could not be read AND there is no earlier copy, so
                      something on screen is genuinely missing;
       · `degraded` — could not be read but the last good copy is being
                      shown, so the board is fine and only that one tab
                      is frozen. */
  function sheetsFailureNote(failed, degraded) {
    var parts = [];
    if (failed && failed.length) parts.push("לא נקראו: " + failed.join(", "));
    if (degraded && degraded.length) {
      parts.push("מהעותק האחרון: " + degraded.join(", "));
    }
    return parts.join(" · ");
  }

  /* ---------- settings tab ----------
     A simple two-column key/value tab, so the principal can change
     presentation (currently the colour theme) without touching code. */
  /* "צבעונית" was the name before the two variants existed; it still maps
     to צבעוני 1 so an older sheet keeps working. */
  /* The two texts the הגדרות tab offers for "אופן הצגת שיעורים". These
     strings are the interface between the sheet and the board: they must
     match LESSON_VIEW in sheet-template/setup.gs exactly, or a choice the
     principal makes is read as "unset" and the board quietly keeps its
     default. English aliases so a hand-made sheet works too. */
  var LESSON_VIEWS = {
    "הצג רק משיעור נוכחי ואילך": "upcoming",
    "הצג את כל השיעורים ביום": "all",
    "upcoming": "upcoming", "all": "all"
  };

  /* The two colourful themes were renamed AND swapped: the pale one is
     now צבעונית 1 and the saturated one צבעונית 2. Every earlier name is
     still accepted, because the sheet on the wall holds whichever text
     was chosen before the change, and setup() must never rewrite what
     the principal typed. A board that stopped recognising the old text
     would fall back to the dark theme overnight with no explanation. */
  var THEMES = {
    "כהה": "dark", "dark": "dark",
    "בהירה": "light", "light": "light",
    "צבעונית 1": "colorful2", "colorful2": "colorful2",
    "צבעונית 2": "colorful", "colorful": "colorful",
    /* superseded names, kept working */
    "צבעוני 1": "colorful", "צבעוני 2": "colorful2", "צבעונית": "colorful"
  };

  function buildSettings(rows) {
    /* lessons stays null when the sheet does not say, so config.js keeps
       the last word — an unrecognised value must not silently pick a
       side, it must fall through to the deployment's own default */
    var out = { theme: "dark", lessons: null };
    (rows || []).forEach(function (r) {
      var key = pick(r, "setting"), val = pick(r, "value");
      if (!key || !val) return;
      if (/ערכת נושא|theme/i.test(key)) {
        var t = THEMES[val.toLowerCase()] || THEMES[val];
        if (t) out.theme = t;
      }
      if (/אופן הצגת שיעורים|lessons/i.test(key)) {
        var v = LESSON_VIEWS[val] || LESSON_VIEWS[val.toLowerCase()];
        if (v) out.lessons = v;
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
  /* `extra` carries gids that config.js knows but the kiosk URL does not.
     A tab added after a board was deployed would otherwise need the URL
     on the wall to be rewritten — which means restarting the kiosk
     session in a school one cannot walk into. A gid is useless on its
     own (it names a tab inside a document it cannot identify), so it is
     safe in the public repository in a way the document id is not, and
     the id stays where it has always been: on the Pi. */
  function parseSheetFragment(hash, extra) {
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
    /* 4 gids = the original four tabs; a 5th is the settings tab (theme),
       a 6th is ימים ללא לימודים. Older kiosk URLs with 4 or 5 keep
       working, and a board given fewer gids simply does without those
       features rather than refusing to start. */
    if (gids.length < 4 || gids.length > 6) return null;
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
    if (gids.length >= 5) out.settings = url(gids[4]);
    if (gids.length >= 6) out.closures = url(gids[5]);
    /* A gid in the URL always wins; config only fills a gap. */
    if (!out.closures && extra && /^\d+$/.test(String(extra.closures || ""))) {
      out.closures = url(String(extra.closures));
    }

    /* ---- s= : the six per-grade מערכת tabs -------------------------
       The timetable moved from one tab holding every grade to one tab
       PER grade, so the schedule needs six gids where it needed one.

       g= IS DELIBERATELY LEFT ALONE. Widening it to eleven entries would
       change what every position means, and the old parser rejects any
       list longer than six outright — so the board on the wall, which
       runs the old code until it is repointed, would drop to DEMO DATA
       the moment it was given the new URL. A fake timetable that looks
       real is the worst failure this board has.

       So the six gids arrive in their own key and the new URL is a
       strict SUPERSET of the old one:

         #d=<doc>&g=<sched>,<exams>,<events>,<messages>,<settings>
                 &s=<ז>,<ח>,<ט>,<י>,<יא>,<יב>

       Which gives two properties worth the extra key:
         · an OLD url (no s=) parses exactly as before — no schedules,
           the single legacy schedule tab, byte-identical behaviour;
         · s= is a key the old parser has never heard of, so the new URL
           is at least ACCEPTED by it rather than rejected into demo
           mode, which is what a widened g= would have caused.

       WHAT IT DOES NOT GIVE, learned the hard way: the new URL does not
       WORK on the old code. That was the claim here, and it rested on
       g= position 0 still naming a readable single-grade מערכת tab. The
       six-tab migration replaced that tab, and its gid now answers HTTP
       400 — verified from the board itself. Old code given the new URL
       therefore fetches a dead tab on every cycle, which is exactly the
       "מנותק מגוגל שיטס" the wall showed during the repoint, with the
       last good timetable still rendered underneath it.

       The lesson kept here rather than in a commit message: g= position
       0 is now a TOMBSTONE. Anything that falls back to it — a
       malformed s=, a rolled-back build, a stale cached app.js — fails
       every cycle, so that path must fail LOUDLY and by name, which is
       what fetchTab()/sheetsFailureNote() in app.js now do.

       A MALFORMED s= IS IGNORED rather than rejected. Returning null
       here would send the board to demo mode, and inventing a school
       day is worse than showing the legacy tab: the operator can see
       that the board did not migrate, and every real safeguard — the
       stamp, the version, the status line — keeps working.

       Ignored, but no longer SILENT: since g= position 0 is a tombstone,
       "ignored s=" and "board permanently disconnected" are now the same
       event, and it must be findable in the console rather than inferred
       from eleven passing requests and one failing one. */
    var s = (p.get("s") || "").split(",").map(function (v) {
      return v.trim();
    }).filter(Boolean);
    if (s.length && !(s.length === 6 &&
        s.every(function (v) { return /^\d+$/.test(v); }))) {
      if (typeof console !== "undefined" && console.error) {
        console.error("kiosk URL: s= is not six numeric gids (" + s.length +
          " given) — ignoring it and falling back to the legacy מערכת tab, " +
          "which no longer exists. Fix s= in the kiosk URL.");
      }
    }
    if (s.length === 6 && s.every(function (v) { return /^\d+$/.test(v); })) {
      out.schedules = s.map(url);
    }
    return out;
  }

  /* ==================================================================
     WHAT A GRADE CARD SHOWS, AND HOW IT PAGES

     Three pure decisions, kept out of app.js so they can be tested
     without a browser. app.js measures the DOM and applies the answers;
     nothing below knows an element exists.

     A "slot" here is ONE PERIOD with all of its concurrent classes.
     That is the unit throughout — which is what makes "never split a
     concurrent group across a page" a property of the data structure
     rather than a check somebody has to remember to run.
     ================================================================== */

  /* Which of a card's periods are on screen right now.

     Two display modes, chosen by the principal in the הגדרות tab:
       "all"       — the whole day stays up, the current period highlighted
       "upcoming"  — a period disappears as it finishes

     Both end the same way: once the last lesson has been over for
     `graceMinutes`, everything goes and the pane hands over to
     "יום הלימודים הסתיים".

     THE ONE SUBTLETY — the retained lesson.
     In "upcoming" mode the break indicator has a problem: it is drawn
     BETWEEN two lessons, and the lesson above it is exactly the one that
     just ended and was therefore just removed. The card would then say
     nothing at all about being on a break, in the mode the school
     actually runs. So while — and only while — this card is between two
     of its own lessons, the period that just finished is kept on the
     card. Only that one, always the whole concurrent group (a slot has
     no smaller unit), and rendered as an ordinary finished lesson: it
     cannot take the "now" highlight, because nothing is "now" in a
     break.

     Returns the indexes to show, in order. */
  function visibleSlots(slots, nowMin, opts) {
    slots = slots || [];
    opts = opts || {};
    var hide = opts.hide === true;
    var grace = opts.graceMinutes || 0;
    if (!slots.length) return [];

    var lastEnd = -1, i, e;
    for (i = 0; i < slots.length; i++) {
      e = minutes(slots[i].end);
      if (e > lastEnd) lastEnd = e;
    }
    /* The bell is an approximation and a lesson often runs over, so the
       day is not over until the last one has finished plus the grace. */
    if (nowMin >= lastEnd + grace) return [];

    var all = [];
    for (i = 0; i < slots.length; i++) all.push(i);
    if (!hide) return all;

    /* never hide the last lesson of the day early — the grace above is
       what protects it, and this is the rule that grace belongs to */
    var keep = all.filter(function (k) {
      return nowMin < minutes(slots[k].end) || minutes(slots[k].end) === lastEnd;
    });
    if (!keep.length) return keep;

    /* Retain, only in a genuine break: nothing running, something
       finished, and something still to come ON THIS CARD. A card whose
       remaining lesson list is empty keeps nothing, so a finished lesson
       can never be the only thing a pupil sees. */
    var running = all.some(function (k) {
      return nowMin >= minutes(slots[k].start) && nowMin < minutes(slots[k].end);
    });
    var upcoming = keep.some(function (k) {
      return minutes(slots[k].start) > nowMin;
    });
    if (running || !upcoming) return keep;

    var done = all.filter(function (k) { return keep.indexOf(k) < 0; });
    if (!done.length) return keep;
    return [done[done.length - 1]].concat(keep);
  }

  /* The seam the break indicator hangs on, as positions within the
     VISIBLE list — which is what the card actually holds boxes for.

     Nothing during a lesson (the highlight already answers "what now"),
     nothing before the first bell, nothing after the last, and nothing
     unless BOTH neighbours are on the card. */
  function breakSeam(visible, nowMin) {
    visible = visible || [];
    var prev = -1, next = -1, i, s, e;
    for (i = 0; i < visible.length; i++) {
      s = minutes(visible[i].start); e = minutes(visible[i].end);
      if (nowMin >= s && nowMin < e) return null;      /* a lesson is running */
      if (e <= nowMin) prev = i;
      else if (next < 0 && s > nowMin) next = i;
    }
    if (prev < 0 || next < 0 || next <= prev) return null;
    return { prev: prev, next: next };
  }

  /* ---------- paging, by measurement ----------
     The shipped board divides the pane height by a constant row height,
     which is exact when every row is 52px and wrong here: a slot holds
     one, two, three or four concurrent classes and its height varies
     with that. So app.js measures the real boxes and this packs them.

     `boxes` are the visible slots in order, each { top, height } in
     layout pixels, measured from the same origin.

     THE ABSOLUTE RULE — a concurrent group is never split across a page
     — holds STRUCTURALLY: the unit being packed is the whole slot, so
     there is no code path that can place part of one. It is not enforced
     by a check because there is nothing to check.

     `avoid` is the index of the slot immediately after the break seam. A
     page must not START there: the pill is centred on the seam, so the
     seam would be the pane's top edge and half the pill would be clipped
     away. Ending the previous page one slot earlier moves the seam
     inside a page. Only possible when that page keeps a slot of its own;
     when it cannot, the caller drops the marker instead of drawing it
     wrong. */
  function packPages(boxes, availH, avoid) {
    boxes = boxes || [];
    if (!boxes.length) return [];
    if (avoid === undefined || avoid === null) avoid = -1;
    var tops = boxes.map(function (b) { return b.top; });
    var bots = boxes.map(function (b) { return b.top + b.height; });
    var out = [], i = 0;
    while (i < boxes.length) {
      var j = i;
      while (j + 1 < boxes.length && bots[j + 1] - tops[i] <= availH) j++;
      if (avoid > i + 1 && j === avoid - 1) j = avoid - 2;
      out.push([i, j]);
      i = j + 1;
    }
    return out;
  }

  /* Each page as a WINDOW the pane can be snapped to: where it starts and
     exactly how tall it is.

     The last page is pulled back to the earliest PERIOD boundary that
     still fits, so it ends flush with the final lesson instead of
     trailing half a pane of white — the shipped board's "anchor to the
     final row", snapped to a whole period rather than to a pixel. */
  function pageWindows(boxes, availH, avoid) {
    boxes = boxes || [];
    if (!boxes.length) return [];
    if (avoid === undefined || avoid === null) avoid = -1;
    var pages = packPages(boxes, availH, avoid);
    var tops = boxes.map(function (b) { return b.top; });
    var bots = boxes.map(function (b) { return b.top + b.height; });
    var contentBottom = bots[bots.length - 1];
    return pages.map(function (p, k) {
      var a = p[0];
      if (k === pages.length - 1 && k > 0) {
        while (a > 0 && contentBottom - tops[a - 1] <= availH) a--;
        if (a === avoid) a++;              /* still never start on the seam */
      }
      var bot = (k === pages.length - 1) ? contentBottom : bots[p[1]];
      return { start: a, end: p[1], top: tops[a],
               height: Math.round(bot - tops[a]) };
    });
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
    sheetsFlag: sheetsFlag,
    sheetsFailureNote: sheetsFailureNote,
    hebrewKey: hebrewKey,
    dayOfTheDay: dayOfTheDay,
    vacationOn: vacationOn,
    buildClosures: buildClosures,
    closureFor: closureFor,
    buildSettings: buildSettings,
    parseSheetFragment: parseSheetFragment,
    clean: clean,
    normalizeVideo: normalizeVideo,
    shouldPlayVideo: shouldPlayVideo,
    buildSchedule: buildSchedule,
    parseGradeTab: parseGradeTab,
    mergeGradeSchedules: mergeGradeSchedules,
    gradeLabelFromTitle: gradeLabelFromTitle,
    gradeKey: gradeKey,
    gradeCell: gradeCell,
    visibleSlots: visibleSlots,
    breakSeam: breakSeam,
    packPages: packPages,
    pageWindows: pageWindows,
    buildAgenda: buildAgenda,
    buildMessages: buildMessages,
    toGematria: toGematria,
    hebrewDate: hebrewDate,
    minutes: minutes,
    validTime: validTime,
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
