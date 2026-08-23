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
    settings: buildSettings(csv.settings ? parseCsv(csv.settings).rows : [])
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
    MODEL = buildModel({ schedule, exams, events, messages, settings }, today);
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
  grid.querySelectorAll(".card:not(#exams):not(#dayofday)")
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
    grid.insertBefore(box, $("exams"));
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
    const rows = periods
      .filter((p) => p.subjects[name])
      .map((p) => `
        <div class="period" data-start="${esc(p.start)}" data-end="${esc(p.end)}">
          <span class="time">${esc(p.start)}–${esc(p.end)}</span>
          <span class="subj">${esc(p.subjects[name])}</span>
        </div>`).join("");
    card.innerHTML = `
      <h2><span class="chip"></span>כיתה ${esc(name)}</h2>
      <div class="periods"><div class="pwrap">${rows}</div></div>`;
    grid.insertBefore(card, $("exams"));
  });
}

/* theme chosen by the principal in the sheet's settings tab */
function applyTheme() {
  const theme = (MODEL.settings && MODEL.settings.theme) || "dark";
  document.documentElement.setAttribute("data-theme", theme);
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
  pane.querySelector(".dodicon").textContent = day.icon;
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
      ? `<span class="gchip all">כל השכבות</span>`
      : grades.map(chipFor).join("");
    return `
      <div class="exam">
        <div class="row1">${chips}<span class="ttl">${title}</span></div>
        <div class="row2"><span>🕐 ${esc(e.start)}–${esc(e.end)}</span><span>📍 ${esc(e.room)}</span></div>
      </div>`;
  }).join("");
  layoutAgendaScroll();
}

/* The day-of-the-day strip eats into the agenda pane, and some days
   simply have more entries than fit. When they overflow, the list
   scrolls gently to the bottom and back rather than hiding anything. */
function layoutAgendaScroll() {
  const box = $("examlist");
  const wrap = box.querySelector(".agendawrap");
  if (!wrap) return;
  wrap.classList.remove("scrolling");
  const overflow = wrap.scrollHeight - box.clientHeight;
  if (overflow <= 4) return;                  /* fits — stay still */
  wrap.style.setProperty("--shift", `-${overflow}px`);
  /* pace by distance so a long list is not faster than a short one */
  wrap.style.setProperty("--adur", `${Math.round(overflow / 18 + 16)}s`);
  wrap.classList.add("scrolling");
}

/* urgent messages rotate in place with a fade; each shows (n/total) */
let urgentTimer = null;
function rotateUrgent(items) {
  if (urgentTimer) { clearInterval(urgentTimer); urgentTimer = null; }
  const el = $("urgenttext");
  const set = (i) =>
    el.innerHTML = `<span class="count">(${i + 1}/${items.length})</span> ${esc(items[i])}`;
  set(0);
  if (items.length > 1) {
    let i = 1;
    urgentTimer = setInterval(() => {
      el.style.opacity = 0;
      setTimeout(() => { set(i % items.length); i++; el.style.opacity = 1; }, 600);
    }, 8000);
  }
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
  el.textContent = msg ? "⚠ " + msg : "";
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

function tick() {
  const now = NOW();
  $("clock").textContent = now.toLocaleTimeString("he-IL",
    { hour: "2-digit", minute: "2-digit" });
  $("date").textContent = now.toLocaleDateString("he-IL",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("hebdate").textContent = hebrewDate(now);
  $("school").textContent = CFG.schoolName;

  const nowMin = now.getHours() * 60 + now.getMinutes();
  document.querySelectorAll(".period").forEach((p) => {
    const s = minutes(p.dataset.start), e = minutes(p.dataset.end);
    p.classList.toggle("now",  nowMin >= s && nowMin < e);
    p.classList.toggle("done", nowMin >= e);   /* passed → hidden */
  });
  document.querySelectorAll(".periods").forEach((c) => {
    const left = c.querySelectorAll(".period:not(.done)").length;
    c.classList.toggle("empty", left === 0);
  });
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

function endVideo() {
  const wrap = $("videowrap"), v = $("video");
  wrap.classList.remove("on");
  v.pause();
  v.removeAttribute("src");
  v.load();                       /* release the decoder on the Pi */
  videoPlaying = false;
}

function maybePlayVideo() {
  if (videoPlaying || !MODEL) return;
  const clips = MODEL.messages.videos;
  if (!clips.length) return;
  if (!shouldPlayVideo(readVideoAt(), Date.now(), CFG.videoIntervalMinutes)) return;

  const clip = clips[videoIndex % clips.length];
  videoIndex++;
  const wrap = $("videowrap"), v = $("video");
  v.muted = !clip.sound;          /* muted by default; #sound opts in */
  v.src = clip.url;
  videoPlaying = true;
  localStorage.setItem(VIDEO_AT_KEY, String(Date.now()));
  wrap.classList.add("on");
  v.onended = endVideo;
  v.onerror = () => {
    console.error("video failed:", clip.url);
    /* a broken link must not retry every minute forever: hold off an
       hour by back-dating the timestamp */
    localStorage.setItem(VIDEO_AT_KEY,
      String(Date.now() + 3600000 - CFG.videoIntervalMinutes * 60000));
    endVideo();
  };
  const p = v.play();
  if (p && p.catch) p.catch(v.onerror);
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
setInterval(advancePages, 8000);
setInterval(maybePlayVideo, 60000);
