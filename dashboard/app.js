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
const FRAGMENT_SHEETS = parseSheetFragment(location.hash);
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

function buildModel(csv, today) {
  const sched = parseCsv(csv.schedule);
  const schedule = buildSchedule(sched.rows, sched.fields);
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

/* ?demo7 previews the 7-grade layout by splitting ז׳ into ז׳1 + ז׳2,
   i.e. exactly what the school would do in the sheet if a grade were
   split — the board adapts with no code change. */
function addSeventhGrade(csv) {
  return csv.split("\n").map((line, i) => {
    const cells = Papa.parse(line).data[0];
    if (i === 0) { cells[4] = "ז׳1"; cells.push("ז׳2"); }
    else cells.push(cells[4]);
    return Papa.unparse([cells]);
  }).join("\n");
}

function sampleCsv(today) {
  const sub = (s) => s.split("{{TODAY}}").join(today);
  const q = new URLSearchParams(location.search);
  const seven = q.has("demo7");
  /* ?theme=light|colorful previews a theme without a sheet */
  const theme = q.get("theme");
  return {
    schedule: seven ? addSeventhGrade(SAMPLE.scheduleCsv) : SAMPLE.scheduleCsv,
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

async function loadData() {
  const today = dateKey(NOW());
  if (DEMO) {
    MODEL = buildModel(sampleCsv(today), today);
    markUpdates(MODEL, today);
    FETCHED_AT = Date.now();
    return;
  }
  try {
    const [schedule, exams, events, messages] = await Promise.all([
      fetchCsv(SHEETS.schedule), fetchCsv(SHEETS.exams),
      fetchCsv(SHEETS.events),   fetchCsv(SHEETS.messages)
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
      { schedule, exams, events, messages, settings, closures }, today);
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
    card.className = "card" + (gi === 6 ? " seventh" : "");
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
      .filter((p) => p.subjects[name])
      .map((p, i) => {
        const changed = UPDATED[name + "|" + p.start] || (UPD_PREVIEW && i === 1);
        return `
        <div class="period" data-start="${esc(p.start)}" data-end="${esc(p.end)}">
          <span class="time">${esc(p.start)}–${esc(p.end)}</span>
          <span class="subj">${esc(p.subjects[name])}</span>
          ${changed ? UPD_BADGE : ""}
        </div>`;
      }).join("");
    card.innerHTML = `
      <h2><span class="chip"></span>כיתה ${esc(name)}</h2>
      <div class="periods"><div class="pwrap">${rows}</div></div>`;
    grid.insertBefore(card, $("leftcol"));
  });
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
  document.querySelectorAll(".period").forEach((p) => {
    const s = minutes(p.dataset.start), e = minutes(p.dataset.end);
    p.classList.toggle("now", nowMin >= s && nowMin < e);
  });

  /* ":not(.closedpane)" matters: a closed grade's pane holds no .period
     rows, so without it the loop below would call it an empty day and
     paint "יום הלימודים הסתיים" over the closure reason. */
  document.querySelectorAll(".periods:not(.closedpane)").forEach((c) => {
    const rows = [...c.querySelectorAll(".period")];
    if (!rows.length) {                    /* no classes at all today */
      c.classList.add("empty");
      c.removeAttribute("data-endtime");
      return;
    }
    let lastEnd = -1, lastEndText = "";
    rows.forEach((p) => {
      const e = minutes(p.dataset.end);
      if (e > lastEnd) { lastEnd = e; lastEndText = p.dataset.end; }
    });

    /* The bell is approximate and a lesson often runs over, so the day is
       not "over" until the last class has finished PLUS a grace period.
       This is measured from the clock rather than from "are any rows still
       showing", which is what lets it work in both modes: when the whole
       day stays on screen no row ever disappears, so counting visible rows
       would mean the end-of-day line could never appear. */
    const dayOver = nowMin >= lastEnd + (CFG.endOfDayGraceMinutes || 0);

    rows.forEach((p) => {
      const e = minutes(p.dataset.end);
      /* Once the day is over every row goes, in BOTH modes, so the pane
         hands over to the end-of-day line rather than leaving a full
         timetable up with nothing highlighted. Before that, a class is
         hidden only if this mode hides classes at all — and never the
         last one of the day, which is what the grace period protects. */
      p.classList.toggle("done",
        dayOver || (hide && nowMin >= e && e !== lastEnd));
    });

    c.dataset.endtime = lastEndText;       /* read by the CSS message */
    c.classList.toggle("empty", dayOver);
  });
  markAgendaDone(nowMin);
  layoutPages();   /* row visibility changed → recompute pages */
  stamp();
}

/* -- paging: a card with more remaining classes than fit cycles
   through them page by page every 8 seconds, by translating the
   row wrapper (a CSS transition does the animation) --------------- */
const ROW_H = 52;   /* must match .period height in style.css */

function layoutPages() {
  document.querySelectorAll(".periods").forEach((c) => {
    const wrap = c.querySelector(".pwrap");
    if (!wrap) return;
    const rows = wrap.querySelectorAll(".period:not(.done)").length;
    const perPage = Math.max(1, Math.floor(c.clientHeight / ROW_H));
    /* snap pane height to a whole number of rows so a partial row
       never peeks out at the bottom */
    c.style.height = (perPage * ROW_H) + "px";
    c.style.flex = "none";
    const pages = Math.max(1, Math.ceil(rows / perPage));
    c.dataset.pages = pages;
    c.classList.toggle("paged", pages > 1);
    const cur = Math.min(+(c.dataset.page || 0), pages - 1);
    c.dataset.page = cur;
    /* scroll the minimum needed: the last page anchors to the final
       row instead of jumping a full page and leaving empty space */
    const start = Math.min(cur * perPage, Math.max(0, rows - perPage));
    wrap.style.transform = `translateY(-${start * ROW_H}px)`;
  });
}

function advancePages() {
  document.querySelectorAll(".periods.paged").forEach((c) => {
    c.dataset.page = (+(c.dataset.page || 0) + 1) % +(c.dataset.pages || 1);
  });
  layoutPages();
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

/* scale the fixed 1920×1080 stage to fit any window */
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  $("stage").style.transform = `translate(-50%, -50%) scale(${s})`;
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
addEventListener("resize", fit);
refresh();
setInterval(refresh, CFG.refreshSeconds * 1000);
setInterval(tick, 5000);

/* The last line to run. index.html's boot watchdog looks for this: if the
   page is up but this was never set, something failed on the way here and
   the board reloads itself rather than standing white on a wall. */
window.__boardBooted = true;
setInterval(advancePages, 8000);
setInterval(maybePlayVideo, 60000);
setInterval(checkForNewVersion, CFG.updateCheckMinutes * 60000);
