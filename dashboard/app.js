/* ==================================================================
   MOCK DATA — this block will be replaced by the Google-Sheets CSV
   fetch in the next phase. The render functions below stay as-is.

   The grade list is DATA-DRIVEN: it will come from the Schedule
   tab's column headers. 6 grades → exams fill the left column;
   7 grades → the 7th card takes top-left and exams move below it.
   Preview the 7-grade layout by adding ?demo7 to the URL.
   ================================================================== */
let GRADES = ["ז׳", "ח׳", "ט׳", "י׳", "י\"א", "י\"ב"];
const ACCENTS = ["--g1", "--g2", "--g3", "--g4", "--g5", "--g6", "--g7"];

let MOCK_SCHEDULE = [
  // period, start, end, subjects per grade ז..י"ב ("" = no class)
  [1, "08:00", "08:45", ["מתמטיקה", "אנגלית",     "פיזיקה",     "ספרות",    "מתמטיקה",  "אזרחות"]],
  [2, "08:50", "09:35", ["לשון",     "מתמטיקה",   "אנגלית",     "מתמטיקה", "פיזיקה",    "מתמטיקה"]],
  [3, "09:50", "10:35", ["אנגלית",  "ביולוגיה",   "מתמטיקה",   "היסטוריה", "כימיה",     "אנגלית"]],
  [4, "10:40", "11:25", ["היסטוריה","לשון",        "ספרות",      "אנגלית",   "אנגלית",    "פיזיקה"]],
  [5, "11:45", "12:30", ["של\"ח",   "חינוך גופני", "תנ\"ך",      "כימיה",    "היסטוריה",  "ספרות"]],
  [6, "12:35", "13:20", ["ביולוגיה","תנ\"ך",       "חינוך גופני","ביולוגיה", "ספרות",     "היסטוריה"]],
  [7, "13:30", "14:15", ["מחשבים",  "מחשבים",     "אזרחות",     "של\"ח",    "לשון",      "תנ\"ך"]],
  [8, "14:20", "15:05", ["",         "",            "מחשבים",     "חינוך",    "חינוך",     "חינוך"]],
  [9, "15:15", "16:00", ["",         "",            "",            "מתמטיקה", "פיזיקה",    "מתמטיקה"]],
  [10,"16:05", "16:50", ["",         "",            "",            "",          "ספרות",     "אזרחות"]],
];

const MOCK_EXAMS = [
  { grade: "ט׳",    subject: "מתמטיקה", start: "09:00", end: "10:30", room: "חדר 12" },
  { grade: "י\"ב", subject: "אנגלית",  start: "11:45", end: "12:30", room: "ספרייה" },
  { grade: "ח׳",    subject: "ביולוגיה", start: "12:35", end: "13:20", room: "מעבדה" },
];

const MOCK_EVENTS = [
  // an event applies to one or more grades; 4+ grades collapse to "כל השכבות"
  { title: "חזרה כללית לטקס",      grades: ["ז׳", "ח׳"],            start: "10:40", end: "11:25", room: "אולם ספורט" },
  { title: "הרצאה: בטיחות ברשת",  grades: ["י׳", "י\"א", "י\"ב"], start: "12:35", end: "13:20", room: "אודיטוריום" },
];

const MOCK_MESSAGES = [
  { text: "אסיפת הורים תתקיים ביום שלישי בשעה 19:00", type: "normal" },
  { text: "מחר: יום כחול-לבן — באים בלבוש חגיגי", type: "normal" },
  { text: "שיעורי שכבת ז׳ מסתיימים היום ב-13:20", type: "urgent" },
  { text: "ההסעה לקו הדרומי יוצאת היום ב-14:00 מהשער האחורי", type: "urgent" },
];

/* demo of the 7-grade layout: ?demo7 splits ז׳ into ז׳1 + ז׳2 */
if (new URLSearchParams(location.search).has("demo7")) {
  GRADES = ["ז׳1", "ח׳", "ט׳", "י׳", "י\"א", "י\"ב", "ז׳2"];
  MOCK_SCHEDULE = MOCK_SCHEDULE.map((p) => {
    const subj = [...p[3], p[3][0]];   // ז׳2 mirrors ז׳1's day for the demo
    return [p[0], p[1], p[2], subj];
  });
}

/* ================================================================
   RENDERING
   ================================================================ */
const $ = (id) => document.getElementById(id);

/* preview helper: ?time=10:30 simulates the clock (date stays real).
   MOCK DEFAULT: while in mockup mode the clock is pinned to 08:10 so
   the full-day design logic is visible — delete the fallback ("08:10")
   when wiring real data. */
const TIME_OVERRIDE =
  new URLSearchParams(location.search).get("time") || "08:10";
function NOW() {
  const d = new Date();
  if (TIME_OVERRIDE) {
    const [h, m] = TIME_OVERRIDE.split(":").map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

/* minutes(), esc(), toGematria(), hebrewDate() and friends come from
   logic.js, which is loaded before this file and unit-tested by
   tests/run.js. */

function renderGrades() {
  const grid = $("grid");
  if (GRADES.length >= 7) grid.classList.add("grades7");
  GRADES.forEach((name, gi) => {
    const card = document.createElement("section");
    card.className = "card" + (gi === 6 ? " seventh" : "");
    card.style.setProperty("--accent", `var(${ACCENTS[gi]})`);
    const rows = MOCK_SCHEDULE
      .filter((p) => p[3][gi] !== "")
      .map((p) => `
        <div class="period" data-start="${p[1]}" data-end="${p[2]}">
          <span class="time">${p[1]}–${p[2]}</span>
          <span class="subj">${p[3][gi]}</span>
        </div>`).join("");
    card.innerHTML = `
      <h2><span class="chip"></span>כיתה ${name}</h2>
      <div class="periods"><div class="pwrap">${rows}</div></div>`;
    grid.insertBefore(card, $("exams"));
  });
}

/* exams + events merged into one agenda, sorted by start time */
function gradeColor(name) {
  const gi = GRADES.indexOf(name);
  return gi >= 0 ? `var(${ACCENTS[gi]})` : "var(--muted)";
}

function renderAgenda() {
  const list = $("examlist");
  const agenda = [
    ...MOCK_EXAMS.map((e) => ({ ...e, kind: "exam" })),
    ...MOCK_EVENTS.map((e) => ({ ...e, kind: "event" })),
  ].sort((a, b) => minutes(a.start) - minutes(b.start));

  if (agenda.length === 0) {
    list.innerHTML = `<div id="noexams">אין אירועים ומבחנים היום 🎉</div>`;
    return;
  }
  list.innerHTML = agenda.map((e) => {
    const row2 = `<div class="row2"><span>🕐 ${e.start}–${e.end}</span><span>📍 ${esc(e.room)}</span></div>`;
    if (e.kind === "exam") {
      /* the sheet holds the bare subject; the board adds the prefix */
      return `
        <div class="exam" style="--gcolor:${gradeColor(e.grade)}">
          <div class="row1"><span class="grade">${e.grade}</span><span class="ttl">מבחן ב${esc(e.subject)}</span></div>
          ${row2}
        </div>`;
    }
    const chips = e.grades.length >= 4
      ? `<span class="gchip all">כל השכבות</span>`
      : e.grades.map((g) =>
          `<span class="gchip" style="--gcolor:${gradeColor(g)}">${g}</span>`).join("");
    return `
      <div class="exam">
        <div class="row1"><span class="ttl">${esc(e.title)}</span></div>
        ${row2}
        <div class="chips">${chips}</div>
      </div>`;
  }).join("");
}

/* urgent banner + rotating normal messages — both rotate with a fade
   when the principal enters more than one message of that type, and
   both show a "(current/total)" counter, e.g. ‎(1/3) */
function rotate(el, items, prefixHtml) {
  const set = (i) => {
    el.innerHTML = `${prefixHtml}<span class="count">(${i + 1}/${items.length})</span> ${esc(items[i].text)}`;
  };
  set(0);
  if (items.length > 1) {
    let i = 1;
    setInterval(() => {
      el.style.opacity = 0;
      setTimeout(() => { set(i % items.length); i++; el.style.opacity = 1; }, 600);
    }, 8000);
  }
}

function renderMessages() {
  const urgent = MOCK_MESSAGES.filter((m) => m.type === "urgent");
  $("urgent").classList.toggle("on", urgent.length > 0);
  if (urgent.length) rotate($("urgenttext"), urgent, "");

  /* bottom strip: all normal messages in one endless scrolling ticker */
  const normal = MOCK_MESSAGES.filter((m) => m.type === "normal");
  const el = $("msg");
  if (!normal.length) { el.textContent = ""; return; }
  const seq = normal.map((m, i) =>
    `<span class="titem"><span class="bullet">●</span><span class="count">(${i + 1}/${normal.length})</span><span>${esc(m.text)}</span></span>`
  ).join("");
  el.innerHTML = `<div class="ticker">${seq}${seq}</div>`;
  /* constant speed regardless of content length: ~80 px/s */
  const t = el.querySelector(".ticker");
  t.style.setProperty("--dur", (t.scrollWidth / 2 / 80) + "s");
}

/* clock, date, current-period highlight, freshness stamp */
function stampNow() {
  const now = new Date();
  const d = now.toLocaleDateString("he-IL",
    { day: "2-digit", month: "2-digit", year: "numeric" });
  const t = now.toLocaleTimeString("he-IL",
    { hour: "2-digit", minute: "2-digit" });
  $("stamp").textContent = `עודכן ${d} · ${t}`;
}

function tick() {
  const now = NOW();
  $("clock").textContent = now.toLocaleTimeString("he-IL",
    { hour: "2-digit", minute: "2-digit" });
  $("date").textContent = now.toLocaleDateString("he-IL",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  $("hebdate").textContent = hebrewDate(now);

  const nowMin = now.getHours() * 60 + now.getMinutes();
  document.querySelectorAll(".period").forEach((p) => {
    const s = minutes(p.dataset.start), e = minutes(p.dataset.end);
    p.classList.toggle("now",  nowMin >= s && nowMin < e);
    p.classList.toggle("done", nowMin >= e);   /* passed → hidden */
  });
  /* a card whose classes are all over shows the end-of-day note */
  document.querySelectorAll(".periods").forEach((c) => {
    const left = c.querySelectorAll(".period:not(.done)").length;
    c.classList.toggle("empty", left === 0);
  });
  layoutPages();   /* row visibility changed → recompute pages */
  /* in mock mode the data is always "fresh"; once wired to the sheet,
     the stamp records the last successful fetch instead */
  stampNow();
}

/* -- paging: a card with more remaining classes than fit cycles
   through them page by page every 8 seconds, by translating the
   row wrapper (CSS transition does the animation) ----------------- */
const ROW_H = 52;   /* must match .period height */

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
setInterval(advancePages, 8000);

/* scale the fixed 1920×1080 stage to fit any preview window */
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  $("stage").style.transform =
    `translate(-50%, -50%) scale(${s})`;
}

renderGrades();
renderAgenda();
renderMessages();
tick();                    /* also runs layoutPages(): page 1 shown at load */
setInterval(tick, 5000);
fit();
addEventListener("resize", fit);
