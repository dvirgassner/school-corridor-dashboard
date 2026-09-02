/* ==================================================================
   app.js — everything that touches the DOM, the network, or time.
   Pure helpers live in logic.js (unit-tested by tests/run.js).

   Data flow, once per refreshSeconds:
     4 CSV URLs → Papa.parse → logic.js builders → MODEL → render
   On any fetch failure the last good MODEL is read back from
   localStorage, so the corridor keeps showing yesterday's truth
   rather than an error page.
   ================================================================== */
const CFG = window.DASH_CONFIG;

/* Where the data comes from, in priority order:
     1. the URL fragment (#t=…&g=…) — how the Pi points at the real
        sheet without the token ever being committed to this public
        repository, or sent to the web server hosting this page
     2. config.js `sheets`, for a private deployment that does not mind
        holding the URLs in code
     3. neither → demo mode with the bundled sample data
   So opening the public GitHub Pages URL shows the demo board, while
   the Pi's kiosk URL shows the school's real data. */
const FRAGMENT_SHEETS = parseSheetFragment(location.hash,
                                           { closures: CFG.closuresGid });
if (location.hash.length > 1 && !FRAGMENT_SHEETS) {
  console.error("unusable sheet fragment; falling back to config/demo:",
                location.hash);
}
const SHEETS = FRAGMENT_SHEETS || CFG.sheets;
const DEMO = !SHEETS;
const CACHE_KEY = "dash-cache";
const ACCENTS = ["--g1", "--g2", "--g3", "--g4", "--g5", "--g6", "--g7"];

const $ = (id) => document.getElementById(id);

/* ---- clock ------------------------------------------------------
   The board runs on real time in the configured timezone, so it follows
   daylight saving automatically (see zonedNow() in logic.js). The Pi
   keeps the underlying clock accurate over NTP.

   ?time=HH:MM overrides the clock for previewing a different hour; in
   demo mode it defaults to 08:10 so a visitor sees a full school day. */
const TIME_OVERRIDE = new URLSearchParams(location.search).get("time") ||
                      (DEMO ? "08:10" : null);
/* ?date=YYYY-MM-DD previews another calendar day (day-of-the-day strip,
   which weekday's timetable shows). Preview only. */
const DATE_OVERRIDE = new URLSearchParams(location.search).get("date");
function NOW() {
  const d = zonedNow(CFG.timeZone);
  if (DATE_OVERRIDE) {
    const [y, mo, da] = DATE_OVERRIDE.split("-").map(Number);
    d.setFullYear(y, mo - 1, da);
  }
  if (TIME_OVERRIDE) {
    const [h, m] = TIME_OVERRIDE.split(":").map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

/* ---- state ------------------------------------------------------ */
let MODEL = null;        /* { grades, byDay, agenda, messages }      */
let FETCHED_AT = null;   /* ms timestamp of last successful read     */
let RENDERED_KEY = "";   /* model fingerprint, to avoid re-rendering */
let SHEETS_OK = null;    /* last data fetch succeeded?               */
let PAGEHOST_OK = null;  /* can we still reach where we were served? */

/* ================================================================
   DATA
   ================================================================ */
function parseCsv(text) {
  const out = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  return { rows: out.data, fields: out.meta.fields || [] };
}

/* The per-grade tabs are a GRID, not a list: the header names repeat once
   per day pair, so there is nothing for header:true to key on and the
   whole tab has to arrive as a matrix of cells. */
function parseMatrix(text) {
  const t = String(text == null ? "" : text).replace(/\r\n/g, "\n")
              .replace(/\n+$/, "");
  if (!t) return [];
  return Papa.parse(t, { header: false }).data;
}

/* One timetable model from whichever source this deployment has.

   Six per-grade tabs is what the school runs now; the single all-grades
   tab is what an older kiosk URL still points at, including the one on
   the wall until it is repointed. Both produce the SAME model shape, so
   nothing downstream — the update marks, the agenda's grade list, the
   closures pane — knows or cares which it got. */
function buildScheduleModel(csv) {
  if (csv.schedules && csv.schedules.length) {
    const labels = CFG.gradeLabels || [];
    return mergeGradeSchedules(
      csv.schedules.map((text, i) => parseGradeTab(parseMatrix(text), labels[i])),
      labels);
  }
  const sched = parseCsv(csv.schedule);
  return buildSchedule(sched.rows, sched.fields);
}

function buildModel(csv, today) {
  const schedule = buildScheduleModel(csv);
  return {
    grades: schedule.grades,
    byDay: schedule.byDay,
    agenda: buildAgenda(parseCsv(csv.exams).rows,
                        parseCsv(csv.events).rows, today, schedule.grades),
    messages: buildMessages(parseCsv(csv.messages).rows, today),
    /* settings tab is optional — absent means defaults */
    settings: buildSettings(csv.settings ? parseCsv(csv.settings).rows : []),
    /* likewise the closures tab: a board whose URL predates it simply
       has no school-specific closures, and still shows every ministry
       vacation from vacations.js */
    closures: buildClosures(
      csv.closures ? parseCsv(csv.closures).rows : [], schedule.grades)
  };
}

function sampleCsv(today) {
  const sub = (s) => s.split("{{TODAY}}").join(today);
  const q = new URLSearchParams(location.search);
  /* ?theme=light|colorful|colorful2 previews a theme without a sheet */
  const theme = q.get("theme");
  return {
    /* Demo mode runs the SAME six-tab path as the school, so there is no
       second code path to rot: the sample data is six per-grade tabs in
       the exact CSV shape the sheet publishes. */
    schedules: SAMPLE.gradeCsv,
    exams: sub(SAMPLE.examsCsv),
    events: sub(SAMPLE.eventsCsv),
    messages: sub(SAMPLE.messagesCsv),
    settings: theme ? "הגדרה,ערך\nערכת נושא," + theme : SAMPLE.settingsCsv
  };
}

async function fetchCsv(url) {
  /* cache-bust: Chromium on the Pi will happily serve a stale CSV for
     hours otherwise */
  const bust = (url.indexOf("?") >= 0 ? "&" : "?") + "_=" + Date.now();
  const res = await fetch(url + bust, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

/* ---- the six per-grade schedule tabs ----------------------------
   Six fetches where there used to be one, which is six chances for a
   transient failure. Losing one tab must not cost the board a grade
   card: the last good copy of THAT tab is kept and reused, per tab, so
   one unreadable grade shows yesterday's timetable while the other five
   are current — rather than the whole board falling back to a cached
   model that is stale for everybody.

   Only if EVERY tab fails does this throw, which hands over to the
   existing whole-model cache path. The per-tab copies are persisted, so
   a restart during an outage still has them. */
const SCHED_CACHE_KEY = "dash-schedule-csv";
let LAST_SCHEDULE = null;

function readSchedCache(n) {
  try {
    const c = JSON.parse(localStorage.getItem(SCHED_CACHE_KEY) || "null");
    if (Array.isArray(c) && c.length === n) return c;
  } catch (e) { /* corrupt or unavailable — start empty */ }
  return null;
}

async function fetchSchedules(urls) {
  if (!LAST_SCHEDULE) {
    LAST_SCHEDULE = readSchedCache(urls.length) || urls.map(() => "");
  }
  const got = await Promise.all(urls.map((u, i) => fetchCsv(u).catch((e) => {
    console.error(`grade tab ${i + 1} unreadable, keeping the last good copy:`, e);
    return null;
  })));
  let anyOk = false;
  const merged = got.map((text, i) => {
    if (text === null) return LAST_SCHEDULE[i] || "";
    anyOk = true;
    return text;
  });
  if (!anyOk) throw new Error("no grade tab could be read");
  LAST_SCHEDULE = merged;
  try {
    localStorage.setItem(SCHED_CACHE_KEY, JSON.stringify(merged));
  } catch (e) { /* quota / private mode — the cache is a bonus */ }
  return merged;
}

async function loadData() {
  const today = dateKey(NOW());
  if (DEMO) {
    MODEL = buildModel(sampleCsv(today), today);
    markUpdates(MODEL, today);
    FETCHED_AT = Date.now();
    return;
  }
  try {
    const perGrade = !!(SHEETS.schedules && SHEETS.schedules.length);
    const [schedules, schedule, exams, events, messages] = await Promise.all([
      perGrade ? fetchSchedules(SHEETS.schedules) : null,
      perGrade ? null : fetchCsv(SHEETS.schedule),
      fetchCsv(SHEETS.exams),
      fetchCsv(SHEETS.events),
      fetchCsv(SHEETS.messages)
    ]);
    /* the settings tab is optional and must never break the board:
       if it is missing or unreachable, defaults apply */
    let settings = "";
    if (SHEETS.settings) {
      try { settings = await fetchCsv(SHEETS.settings); }
      catch (e) { console.error("settings tab unreadable, using defaults:", e); }
    }
    /* The closures tab is optional in the same way, and its failure mode
       is deliberately the safe one: unreadable means "no closure", so the
       board keeps showing the timetable. The opposite default would blank
       a working board because of a transient fetch error. */
    let closures = "";
    if (SHEETS.closures) {
      try { closures = await fetchCsv(SHEETS.closures); }
      catch (e) { console.error("closures tab unreadable, ignoring:", e); }
    }
    MODEL = buildModel(
      { schedules, schedule, exams, events, messages, settings, closures },
      today);
    markUpdates(MODEL, today);
    FETCHED_AT = Date.now();
    SHEETS_OK = true;
    try {
      localStorage.setItem(CACHE_KEY,
        JSON.stringify({ model: MODEL, fetchedAt: FETCHED_AT }));
    } catch (e) { /* private mode / quota — cache is a bonus, not a need */ }
  } catch (err) {
    console.error("fetch failed, falling back to cache:", err);
    SHEETS_OK = false;
    if (MODEL) return;                     /* keep what we already show */
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (c) { MODEL = c.model; FETCHED_AT = c.fetchedAt; }
    } catch (e) { /* corrupt cache → stay empty, render() handles null */ }
  }
}

/* ================================================================
   "עודכן" — spotting a mid-day timetable change
   The principal edits a subject while school is running; students who
   already read the board in the morning have no way to know. So the
   board remembers what it showed earlier today and flags what moved.
   The snapshot lives in localStorage keyed by date, so a browser restart
   mid-morning does not lose the marks, and a new day starts clean.
   ================================================================ */
const SNAP_KEY = "dash-schedule-snap";
let UPDATED = {};                  /* "<grade>|<start>" -> true */

function markUpdates(model, todayKey) {
  const periods = model.byDay[dayLetter(NOW())] || [];
  const snap = {};
  periods.forEach((p) => model.grades.forEach((g) => {
    snap[g + "|" + p.start] = p.subjects[g] || "";
  }));

  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(SNAP_KEY) || "null"); } catch (e) {}
  if (prev && prev.date === todayKey) {
    UPDATED = prev.updated || {};
    Object.keys(snap).forEach((k) => {
      /* only a real substitution counts: a cell going from empty to a
         subject is the timetable being filled in, not a change */
      if (k in prev.snap && prev.snap[k] && snap[k] && prev.snap[k] !== snap[k]) {
        UPDATED[k] = true;
      }
    });
  } else {
    UPDATED = {};                  /* new day, clean slate */
  }
  try {
    localStorage.setItem(SNAP_KEY,
      JSON.stringify({ date: todayKey, snap: snap, updated: UPDATED }));
  } catch (e) { /* private mode — marks are a bonus, not a need */ }
}

/* ?upd previews the badge without waiting for a real edit */
const UPD_PREVIEW = new URLSearchParams(location.search).has("upd");

/* Show the whole day, or drop each class as it finishes?
   Three sources, most specific first:
     1. ?allday=1 / ?allday=0 — for looking at both without changing
        anything, which is how the two were compared
     2. the הגדרות tab — the principal's choice, and the one that matters
     3. config.hidePassedClasses — this deployment's default
   Read on every tick rather than once at load, because the sheet is
   re-read every minute and the principal must not have to reboot a
   corridor screen to change her mind. */
const ALLDAY_OVERRIDE = new URLSearchParams(location.search).get("allday");
function hidePassed() {
  if (ALLDAY_OVERRIDE === "1") return false;
  if (ALLDAY_OVERRIDE === "0") return true;
  const fromSheet = MODEL && MODEL.settings && MODEL.settings.lessons;
  if (fromSheet) return fromSheet === "upcoming";
  return CFG.hidePassedClasses !== false;
}

/* ---- icons -------------------------------------------------------
   Every icon in the board's own chrome is drawn, never an emoji.
   Emoji depend on a colour-emoji font being installed AND covering that
   codepoint; three have already failed us in practice — 🇮🇱 renders as
   the letters "IL" on Windows, 🔄 as an empty box, and 📍 as an empty box
   on Raspberry Pi OS. A missing glyph on a corridor screen is not a
   cosmetic problem: it reads as a broken display.

   These use currentColor, so they follow the text colour in every theme. */
const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true">';

const ICON_CLOCK = SVG_OPEN +
  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';

const ICON_PIN = SVG_OPEN +
  '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/>' +
  '<circle cx="12" cy="10" r="2.4"/></svg>';

/* The same mark for a lesson's room, at the smaller size the grade cards
   use: it needs the .pin class (sized in em, so it tracks the room text)
   and a slightly heavier stroke to survive being drawn that small. */
const ICON_PIN_ROOM = '<svg class="pin" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/>' +
  '<circle cx="12" cy="10" r="2.4"/></svg>';

const ICON_WARN = SVG_OPEN +
  '<path d="M12 3.6 22.2 20.4H1.8z"/><path d="M12 9.4v4.8"/>' +
  '<circle cx="12" cy="17.6" r="0.9" fill="currentColor" stroke="none"/></svg>';

/* The two-arc refresh mark, not the single-loop one.
   currentColor makes it follow the badge's colour in every theme.

   The single loop this replaced was a 300° arc with a stroked corner for
   its arrowhead. At 17px the arc closes up into a plain circle and the
   corner shrinks to a nub, so the badge read as a bullet rather than as
   "this changed". Two separated arcs cannot collapse that way — the gaps
   are part of the silhouette — and the heads are solid triangles rather
   than strokes, which is what survives being scaled down. Chosen by
   rendering candidates at the shipping size and looking at the pixels,
   not by reading the path data.

   Two details that are easy to get wrong. The arcs are SHALLOW crescents
   (121° of a big r=9.2 circle whose centre sits below the icon's), not
   segments of a ring centred on the glyph — tighten them and the mark
   turns back into a circle with lumps on it, which was the whole problem.
   And the viewBox is -1..25 rather than 0..24 because the enlarged heads
   overhang the nominal box by 0.4 units; an svg clips to its viewBox, so
   without the margin both tips would be shaved flat.

   Geometry is generated rather than hand-tuned: each head sits on its
   arc's end point, aligned to the tangent there, and the lower half is
   the upper one rotated 180° so the two can never drift apart. */
const UPD_HALF =
  '<path d="M2.8 9.39A9.2 9.2 0 0 1 16.97 5.05"/>' +
  '<path d="M23.04 9.56L11.87 6.99L17.35 -0.4z" fill="currentColor" stroke="none"/>';
const UPD_BADGE =
  `<span class="upd"><svg viewBox="-1 -1 26 26" fill="none"
     stroke="currentColor" stroke-width="2.6" stroke-linecap="round"
     stroke-linejoin="round" aria-hidden="true">
     <g>${UPD_HALF}</g>
     <g transform="rotate(180 12 12)">${UPD_HALF}</g>
   </svg>עודכן</span>`;

/* ================================================================
   RENDERING
   ================================================================ */
function gradeColor(name) {
  const gi = MODEL.grades.indexOf(name);
  return gi >= 0 ? `var(${ACCENTS[gi]})` : "var(--muted)";
}

function renderGrades() {
  const grid = $("grid");
  /* clear only the generated grade cards — #exams and #dayofday are
     part of the page and must survive a re-render */
  grid.querySelectorAll(":scope > .card:not(#exams):not(#dayofday)")
      .forEach((c) => c.remove());
  const grades = MODEL.grades;
  const periods = MODEL.byDay[dayLetter(NOW())] || [];
  grid.classList.toggle("grades7", grades.length >= 7);

  /* No grade columns at all means the schedule tab is empty or the board
     is pointed at the wrong sheet/gid. Say so plainly — a blank screen
     in a corridor gives whoever is setting it up nothing to work with. */
  if (!grades.length) {
    const box = document.createElement("section");
    box.className = "card nodata";
    box.innerHTML = `<div class="nodatamsg">אין נתוני מערכת שעות
      <span>בדקו את גיליון "מערכת" או את כתובת הלוח</span></div>`;
    grid.insertBefore(box, $("leftcol"));
    return;
  }

  grades.forEach((name, gi) => {
    const card = document.createElement("section");
    card.className = "card grade" + (gi === 6 ? " seventh" : "");
    card.style.setProperty("--accent", `var(${ACCENTS[gi] || "--muted"})`);
    /* Place every card explicitly. Without this, auto-placement spills a
       grade card into the left column whenever the day-of-the-day pane
       is hidden (i.e. on any ordinary day). Columns 1–3 are the grade
       columns; column 4 is the left-hand column. */
    if (gi < 6) {
      card.style.gridColumn = (gi % 3) + 1;
      card.style.gridRow = Math.floor(gi / 3) + 1;
    }
    /* This grade is out — a trip, an outing, or a closure covering the
       whole school, which reaches every card through closureFor. The card
       stays on the board, named, carrying the reason: removing it would
       leave a hole in the grid and tell a passing pupil nothing about
       why their row had vanished. */
    const shut = closureFor(NOW(), MODEL.closures || [], name);
    if (shut) {
      card.innerHTML = `
      <h2><span class="chip"></span>כיתה ${esc(name)}</h2>
      <div class="periods closedpane"><div class="closedmsg">${esc(shut.reason)}</div></div>`;
      grid.insertBefore(card, $("leftcol"));
      return;
    }
    const rows = periods
      .filter((p) => classesIn(p, name).length)
      .map((p, i) => slotHTML(p, name,
        UPDATED[name + "|" + p.start] || (UPD_PREVIEW && i === 1)))
      .join("");
    card.innerHTML = `
      <h2><span class="chip"></span>כיתה ${esc(name)}</h2>
      <div class="periods"><div class="pwrap">${rows}</div></div>`;
    grid.insertBefore(card, $("leftcol"));
  });
}

/* Every class this grade has in this period, in sheet order.

   `entries` is the full picture and is what the six-tab parser fills.
   The fallback to the single-value view is what keeps a board reading an
   OLD single-tab schedule rendering correctly through the same code —
   there is no second renderer, and there must not be. */
function classesIn(p, name) {
  const list = p.entries && p.entries[name];
  if (list && list.length) return list;
  const subject = p.subjects && p.subjects[name];
  return subject ? [{ subject: subject, room: (p.rooms && p.rooms[name]) || "" }]
                 : [];
}

/* ONE PERIOD, with all of its concurrent classes.

   The time cell spans every row of the slot, which is what makes several
   subjects visibly hang off a single clock reading. --n is written inline
   because the row template and the cell's span both count from it — see
   the .slot comment in style.css for why that is not optional.

   data-start / data-end carry the times so tick() can decide "now",
   "finished" and where the break falls straight from the DOM, without a
   parallel model to keep in step. */
function slotHTML(p, name, changed) {
  const list = classesIn(p, name);
  const cls = "slot" + (list.length > 1 ? " multi" : "");
  const lines = list.map((k) =>
    `<div class="subj"><span>${esc(k.subject)}</span></div>` +
    `<div class="room">${k.room
        ? ICON_PIN_ROOM + `<span>${esc(k.room)}</span>` : ""}</div>`
  ).join("");
  /* no dir attribute on the time: the RTL paragraph reorders the range and
     the board shows 08:30–08:15, which is the shipped behaviour */
  return `
    <div class="${cls}" data-start="${esc(p.start)}" data-end="${esc(p.end)}"
         style="--n:${list.length}">
      <div class="tcell">
        <span class="time">${esc(p.start)}–${esc(p.end)}</span>
        ${changed ? UPD_BADGE : ""}
      </div>${lines}
    </div>`;
}

/* theme chosen by the principal in the sheet's settings tab */
function applyTheme() {
  const theme = (MODEL.settings && MODEL.settings.theme) || "dark";
  document.documentElement.setAttribute("data-theme", theme);
  /* Remembered so the next load can paint in the right colours straight
     away — see the inline script in index.html, which reads this before
     the first paint. */
  try { localStorage.setItem("dash-theme", theme); } catch (e) {}
}

/* "day of the day": today's Israeli day, or an international one if
   there is no Israeli day. Hidden entirely on ordinary days so the
   agenda pane gets the whole column. */
function renderDayOfDay() {
  const pane = $("dayofday");
  const day = dayOfTheDay(NOW(), window.DAYS);
  /* on an ordinary day the strip disappears and the agenda pane takes
     the whole left column, rather than leaving a hole in the grid */
  $("grid").classList.toggle("noday", !day);
  if (!day) { pane.classList.add("off"); return; }
  pane.classList.remove("off");
  const icon = pane.querySelector(".dodicon");
  /* svg comes from days.js (our own code, not the sheet), so inserting it
     as markup is safe; emoji go in as text */
  if (day.svg) icon.innerHTML = day.svg;
  else { icon.innerHTML = ""; icon.textContent = day.icon; }
  pane.querySelector(".dodtext").textContent = day.title;
}

function renderAgenda() {
  const list = $("examlist");
  const agenda = MODEL.agenda;
  if (!agenda.length) {
    list.innerHTML = `<div id="noexams">אין אירועים ומבחנים היום 🎉</div>`;
    return;
  }
  list.innerHTML = `<div class="agendawrap"></div>`;
  /* Exams and events share one layout: the grade chip(s) lead, then the
     name, then the details. Identical placement for both kinds is what
     makes the merged pane scannable. */
  const chipFor = (g) =>
    `<span class="gchip" style="--gcolor:${gradeColor(g)}">${esc(g)}</span>`;

  list.querySelector(".agendawrap").innerHTML = agenda.map((e) => {
    const title = e.kind === "exam"
      ? `מבחן ב${esc(e.subject)}`      /* sheet holds the bare subject */
      : esc(e.title);
    const grades = e.kind === "exam" ? [e.grade] : e.grades;
    /* one neutral chip when it applies to everyone — either the כולם box
       is ticked, or so many grades are ticked that listing them is noise */
    const chips = (e.all || grades.length >= 4)
      ? `<span class="gchip all">כולם</span>`
      : grades.map(chipFor).join("");
    return `
      <div class="exam" data-start="${esc(e.start)}" data-end="${esc(e.end)}">
        <div class="row1">${chips}<span class="ttl">${title}</span></div>
        <div class="row2"><span>${ICON_CLOCK}${esc(e.start)}–${esc(e.end)}</span><span>${ICON_PIN}${esc(e.room)}</span></div>
      </div>`;
  }).join("");
  const n = NOW();
  markAgendaDone(n.getHours() * 60 + n.getMinutes());
}

/* Drop agenda entries whose end time has passed, exactly as the grade
   panes drop finished classes: an exam that ended at 10:30 is no longer
   news at 11:00, and the space is better spent on what is still to come.
   Driven from tick() rather than from the model, because the model is
   only rebuilt on a fetch — once a minute at best, and up to ten minutes
   stale if the network is down. */
function markAgendaDone(nowMin) {
  const wrap = document.querySelector(".agendawrap");
  if (!wrap) return;
  let left = 0;
  wrap.querySelectorAll(".exam").forEach((x) => {
    const done = nowMin >= minutes(x.dataset.end);
    x.classList.toggle("done", done);
    if (!done) left++;
  });
  /* everything has happened already — say so, rather than leaving a
     pane that looks like it failed to load */
  wrap.classList.toggle("empty", left === 0);
  layoutAgendaScroll();
}

/* The day-of-the-day strip eats into the agenda pane, and some days
   simply have more entries than fit. When they overflow, the list
   scrolls gently to the bottom and back rather than hiding anything. */
function layoutAgendaScroll() {
  const box = $("examlist");
  const wrap = box.querySelector(".agendawrap");
  if (!wrap) return;
  const overflow = wrap.scrollHeight - box.clientHeight;
  const want = overflow > 4 ? String(overflow) : "";   /* "" = fits, stay still */

  /* Called every second now that entries disappear as they finish, so do
     nothing unless the distance to scroll actually changed. Re-adding the
     class unconditionally would restart the slide from the top on every
     tick and the list would never visibly move. */
  if (wrap.dataset.shift === want) return;
  wrap.dataset.shift = want;

  wrap.classList.remove("scrolling");
  if (!want) return;
  wrap.style.setProperty("--shift", `-${overflow}px`);
  /* pace by distance so a long list is not faster than a short one */
  wrap.style.setProperty("--adur", `${Math.round(overflow / 18 + 16)}s`);
  void wrap.offsetHeight;        /* reflow, so the restart actually takes */
  wrap.classList.add("scrolling");
}

/* urgent messages rotate in place with a fade; each shows (n/total) */
let urgentTimer = null;   /* when to swap to the next urgent message */
let urgentFade  = null;   /* the fade half of that swap                */
/**
 * Fit one urgent message to the strip, scrolling it if it does not fit,
 * and report how long it needs on screen.
 *
 * The strip is narrower than it used to be — it now shares the header
 * with the school name — so overflow is the normal case rather than the
 * exception, and truncating with an ellipsis would hide the end of a
 * notice that was marked urgent. It slides to the end and back instead.
 *
 * The dwell time is returned rather than fixed at 8s: a message that
 * takes 20 seconds to read through must not be swapped out after 8, and
 * a short one should not linger for 20.
 */
function fitUrgent(el) {
  const slide = el.querySelector(".uslide");
  if (!slide) return 8000;
  slide.classList.remove("scrolling");
  const over = slide.scrollWidth - el.clientWidth;
  if (over <= 4) return 8000;                    /* fits — hold it still */
  slide.style.setProperty("--ushift", `${over}px`);
  /* Paced by distance, halved twice from the original — both terms each
     time, so long and short notices stay proportional to each other
     rather than all converging on one speed. The floor stops a barely
     overflowing message from twitching.

     If this ever reads as too brisk, the travel is not the thing to
     lengthen: widen the pauses in the urgentslide keyframes instead. The
     eye needs a still moment at each end to catch the start and the end
     of the sentence; the sweep between them can be quick. */
  const secs = Math.max(4, Math.round(over / 152 + 2.25));
  slide.style.setProperty("--udur", `${secs}s`);
  slide.classList.add("scrolling");
  return secs * 1000;        /* one full there-and-back before the next */
}

function rotateUrgent(items) {
  if (urgentTimer) { clearTimeout(urgentTimer); urgentTimer = null; }
  if (urgentFade) { clearTimeout(urgentFade); urgentFade = null; }
  const el = $("urgenttext");
  let i = 0;
  const show = () => {
    el.innerHTML =
      `<span class="uslide"><span class="count">(${i + 1}/${items.length})</span> ` +
      `${esc(items[i])}</span>`;
    const hold = fitUrgent(el);
    /* A single message still scrolls — it just loops instead of being
       replaced, which is the whole point of not truncating it. */
    if (items.length < 2) return;
    urgentTimer = setTimeout(() => {
      el.style.opacity = 0;
      urgentFade = setTimeout(() => {
        i = (i + 1) % items.length;
        show();
        el.style.opacity = 1;
      }, 600);
    }, hold);
  };
  show();
}

function renderMessages() {
  const { normal, urgent } = MODEL.messages;
  $("urgent").classList.toggle("on", urgent.length > 0);
  if (urgent.length) rotateUrgent(urgent);

  /* bottom strip: all normal messages in one endless scrolling ticker */
  const el = $("msg");
  if (!normal.length) { el.textContent = ""; return; }
  const seq = normal.map((text, i) =>
    `<span class="titem"><span class="bullet">●</span><span class="count">(${i + 1}/${normal.length})</span><span>${esc(text)}</span></span>`
  ).join("");
  el.innerHTML = `<div class="ticker">${seq}${seq}</div>`;
  /* constant speed regardless of content length: ~80 px/s */
  const t = el.querySelector(".ticker");
  t.style.setProperty("--dur", (t.scrollWidth / 2 / 80) + "s");
}

/* re-render only when the data actually changed, so the paging
   position and ticker animation are not reset every minute */
function render() {
  if (!MODEL) return;
  const key = JSON.stringify(MODEL);
  if (key === RENDERED_KEY) return;
  RENDERED_KEY = key;
  applyTheme();
  renderDayOfDay();
  renderGrades();
  renderAgenda();
  renderMessages();
  tick();
}

/* ================================================================
   CLOCK TICK, PAGING, STAMP
   ================================================================ */
/* Can we still reach the host that served this page? Answering it needs
   a real request: the page itself has been in memory for hours, so its
   presence proves nothing about the network now. */
async function checkPageHost() {
  try {
    const r = await fetch("config.js?_=" + Date.now(), { cache: "no-store" });
    PAGEHOST_OK = r.ok;
  } catch (e) {
    PAGEHOST_OK = false;
  }
}

/* ?err=offline|sheets|github forces the indicator, for previews */
const ERR_PREVIEW = new URLSearchParams(location.search).get("err");

function renderStatus() {
  const el = $("errind");
  let msg;
  if (ERR_PREVIEW) {
    msg = statusMessage({
      online: ERR_PREVIEW !== "offline",
      sheets: ERR_PREVIEW !== "sheets",
      pageHost: ERR_PREVIEW !== "github"
    });
  } else if (DEMO) {
    msg = null;                       /* demo mode has nothing to fetch */
  } else {
    msg = statusMessage({
      online: navigator.onLine !== false,
      sheets: SHEETS_OK,
      pageHost: PAGEHOST_OK
    });
  }
  el.classList.toggle("on", !!msg);
  el.innerHTML = msg ? ICON_WARN + esc(msg) : "";
}

function stamp() {
  const el = $("stamp");
  $("version").textContent = "v" + CFG.version;
  renderStatus();
  if (!FETCHED_AT) { el.textContent = "אין נתונים"; el.classList.add("stale"); return; }
  const at = zonedNow(CFG.timeZone, new Date(FETCHED_AT));
  const d = at.toLocaleDateString("he-IL",
    { day: "2-digit", month: "2-digit", year: "numeric" });
  const t = at.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  el.textContent = (DEMO ? "מצב הדגמה · " : "") + `עודכן ${d} · ${t}`;
  const ageMin = (Date.now() - FETCHED_AT) / 60000;
  el.classList.toggle("stale", !DEMO && ageMin > CFG.staleMinutes);
}

/**
 * Name the board, without disturbing the logo.
 *
 * config.js still carries schoolName so a fork can set its own without
 * editing markup; here it becomes the logo's alt text, which is also the
 * fallback shown if the image ever fails to load. Idempotent, so calling
 * it from tick() costs nothing.
 */
function setSchoolName(name) {
  const box = $("school");
  if (!box) return;
  const logo = box.querySelector("img");
  if (logo) {
    if (logo.alt !== name) logo.alt = name;
  } else if (box.textContent !== name) {
    box.textContent = name;          /* no logo in this build */
  }
}

/* ---------- school closed ----------
   On a vacation day the board shows only the header and one line naming
   the vacation. Everything else is hidden: with the building empty there
   is nobody to read a schedule, and one still sitting on the wall invites
   the first person back to trust it.

   It is named rather than simply blanked. A dark screen in a corridor is
   indistinguishable from a dead one, and the people who walk past cannot
   tell which it is — the whole status-indicator design exists for that
   reason, and blanking the board would throw it away.

   This runs on the clock tick, not in render(), because it turns on the
   DATE changing rather than on new sheet data. A board left running
   overnight into the first morning of a vacation receives no new model,
   so a check living in render() would never fire. The cached key keeps
   it to one DOM write per change instead of one per second. */
let VACATION_KEY = null;
function applyVacation() {
  /* ONLY the ministry's calendar produces this screen. A closure the
     school entered itself — a trip, a strike — always speaks through the
     grade cards instead, even when it covers every grade: those carry the
     school's own words, and replacing six specific reasons with one
     borrowed headline would say less than the sheet already does. */
  const vac = vacationOn(NOW(), window.VACATIONS || []);
  const label = vac ? vac.title : null;
  const key = label || "";
  if (key === VACATION_KEY) return;
  VACATION_KEY = key;
  document.body.classList.toggle("vacation", !!label);
  const el = $("vacationnote");
  if (el) el.textContent = label || "";
}

function tick() {
  const now = NOW();
  $("clock").textContent = now.toLocaleTimeString("he-IL",
    { hour: "2-digit", minute: "2-digit" });
  $("date").textContent = now.toLocaleDateString("he-IL",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("hebdate").textContent = hebrewDate(now);
  /* The school's identity is the logo in index.html, and it does not
     change from second to second. This used to be
     `$("school").textContent = CFG.schoolName`, which rewrote the element
     on every tick and so deleted the <img> the moment it was added —
     the board fell back to the alt text and looked, convincingly, as
     though the image had failed to load. The name now reaches the page
     as that alt text, set once. */
  setSchoolName(CFG.schoolName);
  applyVacation();

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const hide = hidePassed();

  /* ":not(.closedpane)" matters: a closed grade's pane holds no slots,
     so without it the loop below would call it an empty day and paint
     "יום הלימודים הסתיים" over the closure reason. */
  document.querySelectorAll(".periods:not(.closedpane)").forEach((c) => {
    const slots = [...c.querySelectorAll(".slot")];
    if (!slots.length) {                    /* no classes at all today */
      c.classList.add("empty");
      c.removeAttribute("data-endtime");
      return;
    }
    let lastEnd = -1, lastEndText = "";
    slots.forEach((s) => {
      const e = minutes(s.dataset.end);
      if (e > lastEnd) { lastEnd = e; lastEndText = s.dataset.end; }
    });

    /* Which periods this card shows is one decision, made in logic.js and
       tested there: the display mode, the end-of-day grace, and the one
       finished lesson a break keeps so the break marker has something to
       hang under. Everything here just applies the answer. */
    const shown = visibleSlots(
      slots.map((s) => ({ start: s.dataset.start, end: s.dataset.end })),
      nowMin, { hide: hide, graceMinutes: CFG.endOfDayGraceMinutes || 0 });
    const on = {};
    shown.forEach((i) => { on[i] = true; });
    slots.forEach((s, i) => {
      s.classList.toggle("done", !on[i]);
      const a = minutes(s.dataset.start), b = minutes(s.dataset.end);
      s.classList.toggle("now", nowMin >= a && nowMin < b);
    });

    c.dataset.endtime = lastEndText;       /* read by the CSS message */
    c.classList.toggle("empty", shown.length === 0);
  });
  markAgendaDone(nowMin);
  layoutCards();   /* slot visibility changed → re-measure pages */
  stamp();
}

/* ================================================================
   PAGING AND THE BREAK MARKER — one pass, because they are the same
   measurement.

   WHY THE OLD ARITHMETIC IS GONE. This used to be

       perPage = floor(pane.clientHeight / 52)

   which was exact when every row was a 52px .period. A .slot is one
   PERIOD holding one to four concurrent classes, so slot heights now run
   26 / 49 / 73.5 / 98px and the gap between periods is not the gap
   inside a group (there is none). A uniform-row divide is wrong in both
   directions.

   WHAT REPLACES IT: the real offsetTop / offsetHeight of each visible
   slot, packed greedily into pages by logic.js. The absolute rule —
   never split a concurrent group across a page — holds structurally
   rather than by a check, because the unit being packed is the whole
   slot and a slot is exactly one period.

   NO PARTIAL PERIOD PEEKS. Pages hold different numbers of lines, so a
   page rarely ends on the pane's bottom edge. The shipped answer was to
   snap the pane to a whole number of rows; the same answer works here
   with a height that is measured instead of multiplied — the pane is
   snapped to the exact pixel height of the page it is showing, and its
   overflow:hidden then cuts on a period boundary by definition.
   ================================================================ */
const PAGE_MS = 8000;      /* the shipped cadence, unchanged */
const PILL_CLEAR = 5;      /* px wanted clear above AND below the pill;
                              the review's floor is 4, this asks for 5 so
                              rounding cannot take it under */

function ensureNowLine(wrap) {
  let el = wrap.querySelector(".nowline");
  if (!el) {
    el = document.createElement("div");
    el.className = "nowline";
    el.innerHTML = '<span class="nlrule"></span>' +
                   '<span class="nlpill">יצאנו להפסקה...</span>' +
                   '<span class="nlrule"></span>';
    wrap.appendChild(el);
  }
  return el;
}

const subjOf = (slot) => [...slot.querySelectorAll(".subj")];

function layoutCard(pane) {
  const wrap = pane.querySelector(".pwrap");
  if (!wrap) return;                       /* a closed grade's pane */

  /* -- 0 · reset every injected geometry, so this pass is idempotent
        and can be re-run on every tick and every page advance -------- */
  [...wrap.querySelectorAll(".slot")].forEach((s) => { s.style.marginTop = ""; });
  pane.style.height = "";     /* back to flex:1, so the AVAILABLE height */
  pane.style.flex = "";       /* can be read before it is snapped again  */
  let line = wrap.querySelector(".nowline");
  if (line) { line.remove(); line = null; }

  const slots = [...wrap.querySelectorAll(".slot:not(.done)")];
  if (!slots.length) {
    wrap.style.transform = "translateY(0)";
    pane.dataset.pages = "1";
    pane.dataset.page = "0";
    pane.classList.remove("paged");
    return;
  }

  const n = NOW();
  const nowMin = n.getHours() * 60 + n.getMinutes();
  const times = slots.map((s) => ({ start: s.dataset.start, end: s.dataset.end }));

  /* -- 1 · the seam, and the channel the pill needs there.
        The gap comes from the pill's OWN rendered height rather than a
        constant, which is what makes the clearance survive a change of
        type or theme without a second set of numbers. ---------------- */
  let seam = breakSeam(times, nowMin);
  if (seam) {
    line = ensureNowLine(wrap);
    const pillH = line.querySelector(".nlpill").getBoundingClientRect().height / SCALE;
    const a = subjOf(slots[seam.prev]).pop().getBoundingClientRect();
    const b = subjOf(slots[seam.next])[0].getBoundingClientRect();
    const chan = (b.top - a.bottom) / SCALE;        /* the natural channel */
    const grow = Math.max(0, Math.ceil(pillH + 2 * PILL_CLEAR - chan));
    if (grow) slots[seam.next].style.marginTop = grow + "px";
  }

  /* -- 2 · pack whole slots into pages, by measurement --------------- */
  const availH = pane.clientHeight;                /* layout px, unscaled */
  const boxes = () => slots.map((s) => ({ top: s.offsetTop, height: s.offsetHeight }));
  let bx = boxes();
  let avoid = seam ? seam.next : -1;
  let wins = pageWindows(bx, availH, avoid);

  /* The "never start a page on the slot after the break" rule can fail —
     a page holding a single period has nothing to give back. Then the
     marker is dropped rather than drawn half off the pane's top edge,
     and the channel it asked for is handed back. */
  if (seam && wins.some((w, k) => k > 0 && w.start === avoid)) {
    slots[seam.next].style.marginTop = "";
    if (line) { line.remove(); line = null; }
    seam = null;
    bx = boxes();                       /* the channel is gone: re-measure */
    wins = pageWindows(bx, availH, -1);
  }

  /* -- 3 · snap the pane to the page it is showing, and translate ---- */
  const pages = wins.length;
  pane.dataset.pages = String(pages);
  const cur = Math.min(Math.max(0, +(pane.dataset.page || 0)), pages - 1);
  pane.dataset.page = String(cur);
  pane.classList.toggle("paged", pages > 1);
  if (pages > 1) {
    pane.style.height = wins[cur].height + "px";
    pane.style.flex = "none";
  }
  wrap.style.transform = `translateY(-${wins[cur].top}px)`;

  /* -- 4 · park the marker on the seam, measured after the padding.
        Midway between the INK boxes above and below, not between the
        slot boxes, so the clearance really is equal on both sides. --- */
  if (seam && line) {
    const wr = wrap.getBoundingClientRect();
    const a = subjOf(slots[seam.prev]).pop().getBoundingClientRect();
    const b = subjOf(slots[seam.next])[0].getBoundingClientRect();
    line.style.top = ((((a.bottom + b.top) / 2) - wr.top) / SCALE).toFixed(2) + "px";
  }
}

function layoutCards() {
  document.querySelectorAll(".periods").forEach(layoutCard);
  setupScrollers();
}

function advancePages() {
  document.querySelectorAll(".periods.paged").forEach((c) => {
    c.dataset.page = (+(c.dataset.page || 0) + 1) % +(c.dataset.pages || 1);
  });
  layoutCards();
}

/* ================================================================
   SCROLLING SUBJECT NAMES

   A streamed subject name — "מעורבים בקהילה (מורה א, מורה ב)" — is longer
   the column, and truncating it hides exactly the part that says which
   group a pupil belongs in. So names that do not fit move instead:

     · only names that ACTUALLY overflow, decided by measuring
       scrollWidth against clientWidth, never by counting characters;
     · slow and mostly still — a long pause at each end and a ~15px/s
       glide, so at any moment nearly every name on the board is
       stationary;
     · starts staggered, so six panes never pulse in unison;
     · RTL-correct: the travel direction comes from the computed
       `direction`, so the runner moves toward the reading start.

   Called from every layout pass, and therefore IDEMPOTENT: a name whose
   overflow has not changed keeps the animation it already has. Restarting
   them all on each tick would park every name back at its start every
   five seconds and nothing would ever visibly move.
   ================================================================ */
const SCROLL = {
  speed:     15,    /* px per second — calm enough for a wall display  */
  holdStart: 3.0,   /* seconds parked at the name's beginning          */
  holdEnd:   2.6,   /* seconds parked at the name's end                */
  reset:     0.45,  /* seconds to RESET — one quick eased gesture, not
                       a second slow scroll. Halving the return is what
                       keeps the duty cycle down.                       */
  holdAfter: 1.8,   /* seconds parked after the reset                  */
  minGlide:  1.4,   /* never faster than this, however short the run   */
  spread:    2.8,   /* seconds. The window the per-name phase offsets are
                       scattered across. Bounded deliberately: spread
                       across the whole cycle instead, a name could sit
                       dead still for the 3s hold PLUS up to 15s of delay
                       before it first moved. This keeps every name's
                       first movement inside 3.0-5.8s, and because each
                       cycle is a function of that name's own overflow
                       they drift apart from there rather than locking.  */
  fade:      12     /* px of edge mask; travel overshoots by exactly this */
};
/* Multiples of the golden ratio, taken mod 1, land as far from each other
   as a deterministic sequence can — so consecutive scrollers get offsets
   scattered rather than stepping in a fixed increment that wraps and puts
   them back in step once there are more than a handful. */
const PHI = 0.6180339887;

let scrollSeq = 0;
function setupScrollers() {
  let k = 0;
  document.querySelectorAll(".card.grade .subj").forEach((el) => {
    const run = el.firstElementChild;
    if (!run) return;
    /* MEASURED, not guessed. A hidden slot measures 0 and is simply left
       alone until it is shown, at which point its overflow changes and it
       is configured then. */
    const over = el.scrollWidth - el.clientWidth;
    if (el._over === over) { if (over > 1) k++; return; }   /* unchanged */
    el._over = over;
    if (el._anim) { el._anim.cancel(); el._anim = null; }
    el.classList.remove("scroll");
    if (over <= 1) return;            /* it fits: leave it perfectly still */

    /* RTL: the overflow hangs off the physical LEFT, so the runner travels
       in the positive x direction to bring the tail into view. Taken from
       the computed direction rather than assumed. */
    const sign = getComputedStyle(el).direction === "rtl" ? 1 : -1;
    const dist = over + SCROLL.fade;
    const glide = Math.max(SCROLL.minGlide, dist / SCROLL.speed);
    const t1 = SCROLL.holdStart,
          t2 = t1 + glide,
          t3 = t2 + SCROLL.holdEnd,
          t4 = t3 + SCROLL.reset,
          tot = t4 + SCROLL.holdAfter;
    const dx = (sign * dist) + "px";
    const ease = "cubic-bezier(.42,0,.58,1)";     /* soft start, soft stop */

    el.classList.add("scroll");
    el._anim = run.animate([
      { offset: 0,       transform: "translateX(0px)", easing: "linear" },
      { offset: t1 / tot, transform: "translateX(0px)", easing: ease },
      { offset: t2 / tot, transform: `translateX(${dx})`, easing: "linear" },
      { offset: t3 / tot, transform: `translateX(${dx})`, easing: ease },
      { offset: t4 / tot, transform: "translateX(0px)", easing: "linear" },
      { offset: 1,       transform: "translateX(0px)" }
    ], {
      duration: tot * 1000,
      iterations: Infinity,
      /* every scroller starts PARKED, and late by a different fraction of
         its own cycle, so nothing is mid-travel when the board first
         paints and the six panes never move together */
      delay: ((scrollSeq++ * PHI) % 1) * SCROLL.spread * 1000
    });
    k++;
  });
  return k;
}

/* ================================================================
   VIDEO — clips the principal adds to the Messages tab play
   full-screen once per videoIntervalMinutes, then the board returns.
   ================================================================ */
const VIDEO_AT_KEY = "dash-video-at";
let videoPlaying = false;
let videoIndex = 0;

function readVideoAt() {
  const v = +(localStorage.getItem(VIDEO_AT_KEY) || 0);
  return v || null;
}

let videoGuard = null;            /* safety timer, see playYouTube */

function endVideo() {
  const wrap = $("videowrap"), v = $("video");
  wrap.classList.remove("on", "file", "yt");
  v.pause();
  v.removeAttribute("src");
  v.load();                       /* release the decoder on the Pi */
  $("ytframe").src = "about:blank";   /* stop YouTube playing offscreen */
  if (videoGuard) { clearTimeout(videoGuard); videoGuard = null; }
  videoPlaying = false;
}

/* YouTube plays through its official embed rather than being downloaded.
   The embed gives us no "finished" event without loading YouTube's API,
   so a guard timer closes the overlay; the board is showing schedules,
   not running a cinema, and a stuck overlay is the only real risk. */
function playYouTube(clip) {
  const wrap = $("videowrap"), f = $("ytframe");
  const p = new URLSearchParams({
    autoplay: "1",
    mute: clip.sound ? "0" : "1",   /* muted autoplay always allowed */
    controls: "0",
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    fs: "0",
    iv_load_policy: "3"             /* no annotations */
  });
  f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(clip.id)}?${p}`;
  wrap.classList.add("on", "yt");
  videoGuard = setTimeout(endVideo, CFG.youtubeMaxMinutes * 60000);
}

function maybePlayVideo() {
  if (videoPlaying || !MODEL) return;
  const clips = MODEL.messages.videos;
  if (!clips.length) return;
  if (!shouldPlayVideo(readVideoAt(), Date.now(), CFG.videoIntervalMinutes)) return;

  const clip = clips[videoIndex % clips.length];
  videoIndex++;
  videoPlaying = true;
  localStorage.setItem(VIDEO_AT_KEY, String(Date.now()));

  if (clip.kind === "youtube") { playYouTube(clip); return; }

  const wrap = $("videowrap"), v = $("video");
  v.muted = !clip.sound;          /* muted by default; #sound opts in */
  v.src = clip.src;
  wrap.classList.add("on", "file");
  v.onended = endVideo;
  v.onerror = () => {
    console.error("video failed:", clip.src, clip.drive
      ? "(Drive link — is the file shared with 'anyone with the link'?)" : "");
    /* a broken link must not retry every minute forever: hold off an
       hour by back-dating the timestamp */
    localStorage.setItem(VIDEO_AT_KEY,
      String(Date.now() + 3600000 - CFG.videoIntervalMinutes * 60000));
    endVideo();
  };
  const p = v.play();
  if (p && p.catch) p.catch(v.onerror);
}

/* Register the service worker, which keeps a copy of the page's own
   files so a restart during an internet outage still has something to
   load. Needs a real origin — over file:// it is unavailable, which is
   why this is guarded rather than assumed. */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.error("service worker registration failed:", err);
    });
  });
}

/* ================================================================
   SELF-UPDATE
   The board re-reads the sheet every minute, but the page's own code is
   whatever Chromium loaded at boot — so a fix could sit unseen on a wall
   for a day, until the nightly reboot. This polls config.js for a
   changed version string and reloads when one appears.

   Comparing versions rather than reloading on a timer means the page
   reloads only when there is genuinely something new, which keeps the
   screen still the rest of the time.
   ================================================================ */
async function checkForNewVersion() {
  if (videoPlaying) return;             /* never interrupt a clip */
  try {
    const r = await fetch("config.js?_=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return;
    const m = (await r.text()).match(/version:\s*"([^"]+)"/);
    if (m && m[1] !== CFG.version) {
      console.log(`new version ${m[1]} (running ${CFG.version}) — reloading`);
      location.reload();                /* keeps the #d=… fragment */
    }
  } catch (e) { /* offline: try again next time */ }
}

/* Scale the fixed 1920×1080 stage to fit any window.

   SCALE is kept because the layout pass mixes two coordinate systems:
   offsetTop / offsetHeight are layout pixels (unscaled), while
   getBoundingClientRect — the only way to measure where a line of INK
   actually sits — returns screen pixels, i.e. already multiplied by
   this. Dividing by it puts both back in stage pixels. On the TV it is
   1 and none of this matters; in a scaled preview window it is what
   keeps the break marker on its seam. */
let SCALE = 1;
function fit() {
  SCALE = Math.min(innerWidth / 1920, innerHeight / 1080);
  $("stage").style.transform = `translate(-50%, -50%) scale(${SCALE})`;
}

/* ================================================================
   BOOT
   ================================================================ */
async function refresh() {
  const before = dateKey(NOW());
  await Promise.all([loadData(), DEMO ? null : checkPageHost()]);
  /* crossing midnight changes which day's schedule applies */
  if (MODEL && before !== dateKey(NOW())) RENDERED_KEY = "";
  render();
}

fit();
/* a resize changes the stage scale, and with it every measurement the
   page packer and the break marker were placed from */
addEventListener("resize", () => { fit(); layoutCards(); });

/* THE FIRST LAYOUT PASS RUNS BEFORE THE WEBFONT ARRIVES.
   font-display:swap paints the board in the fallback face and swaps
   Assistant in when it loads, which silently changes every text width —
   so the page packer's measurements and the "does this name overflow?"
   question were both answered against a font that is no longer on
   screen. It self-corrected on the next 5s tick, but until then a card
   could show the wrong number of pages and a name that needs to scroll
   could sit still. Re-measuring when the fonts settle costs one layout
   pass and removes the race. */
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => layoutCards()).catch(() => {});
}
refresh();
setInterval(refresh, CFG.refreshSeconds * 1000);
setInterval(tick, 5000);

/* The last line to run. index.html's boot watchdog looks for this: if the
   page is up but this was never set, something failed on the way here and
   the board reloads itself rather than standing white on a wall. */
window.__boardBooted = true;
setInterval(advancePages, PAGE_MS);
setInterval(maybePlayVideo, 60000);
setInterval(checkForNewVersion, CFG.updateCheckMinutes * 60000);
