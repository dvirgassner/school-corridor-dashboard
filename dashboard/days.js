/* ==================================================================
   days.js — "day of the day" calendar.

   Two curated lists, checked in this order:
     1. ISRAELI — official Israeli days and Jewish holidays. Most are
        fixed to the HEBREW calendar, so they are keyed by Hebrew
        month + day and land correctly every year without maintenance.
        A few are Gregorian-fixed and keyed that way.
     2. INTERNATIONAL — Gregorian, used only when no Israeli day falls
        on that date.

   Icons are emoji on purpose: nothing to host, nothing to break, no
   external request (the board must work with the network down).

   Scope: the audience is high-school students in an Israeli school, so
   entries are limited to days that are meaningful in that setting.
   Commemorations aimed at younger children, and days whose subject
   matter is not appropriate for a public corridor display, are left
   out deliberately — this list is a curation, not a dump of every
   observance that exists.

   Hebrew month names use the English spellings that
   Intl.DateTimeFormat("en-u-ca-hebrew") produces:
     Tishri Heshvan Kislev Tevet Shevat Adar "Adar I" "Adar II"
     Nisan Iyar Sivan Tamuz Av Elul
   In a leap year, Adar-dated entries also match Adar II, which is
   where those observances actually fall.
   ================================================================== */
/* Inline SVG of the Israeli flag. An emoji flag (🇮🇱) is NOT usable here:
   Windows and several Linux font stacks render country-flag sequences as
   the two letters "IL" instead of a flag, so the board would show text
   where a flag belongs. Drawing it is the only portable answer. */
/* Stylised old Jerusalem: city wall with crenellations, a gate, a dome
   and towers. Used for both יום ירושלים and חג הסיגד, whose prayer is
   directed towards Jerusalem. */
var ART_JERUSALEM =
  '<svg viewBox="0 0 84 56" role="img" aria-label="ירושלים העתיקה">' +
  '<rect x="38.6" y="7" width="1.8" height="6" fill="#c9a227"/>' +
  '<path d="M39.5 13.5a10 10 0 0 1 10 10h-20a10 10 0 0 1 10-10z" fill="#4f9ecb"/>' +
  '<rect x="29.5" y="23" width="20" height="4" fill="#3d84ad"/>' +
  '<rect x="11" y="18" width="11" height="16" fill="#d3c19a"/>' +
  '<rect x="9.5" y="15" width="14" height="3.5" fill="#bda879"/>' +
  '<rect x="60" y="22" width="13" height="12" fill="#d3c19a"/>' +
  '<rect x="6" y="34" width="72" height="17" rx="1" fill="#e3d6b0"/>' +
  '<g fill="#e3d6b0">' +
  '<rect x="6" y="30" width="7" height="4"/><rect x="19" y="30" width="7" height="4"/>' +
  '<rect x="32" y="30" width="7" height="4"/><rect x="45" y="30" width="7" height="4"/>' +
  '<rect x="58" y="30" width="7" height="4"/><rect x="71" y="30" width="7" height="4"/>' +
  '</g>' +
  '<path d="M36 51v-8a6 6 0 0 1 12 0v8z" fill="#6f5f45"/>' +
  '</svg>';

/* Theodor Herzl — a stylised silhouette (the full beard is the read),
   not a portrait likeness. */
var ART_HERZL =
  '<svg viewBox="0 0 56 56" role="img" aria-label="בנימין זאב הרצל">' +
  /* jacket and collar */
  '<path d="M7 56c0-11 9.5-16 21-16s21 5 21 16z" fill="#3f4d61"/>' +
  '<path d="M20.5 41h15l-4 8h-7z" fill="#f2efe6"/>' +
  /* face, kept light so the silhouette reads on a dark card */
  '<ellipse cx="28" cy="21" rx="11" ry="12.5" fill="#e6c6a4"/>' +
  /* hair */
  '<path d="M16.6 19.5C17.3 11.8 22 7.5 28 7.5s10.7 4.3 11.4 12c-2.4-3-6.3-4.6-11.4-4.6' +
  's-9 1.6-11.4 4.6z" fill="#2a201a"/>' +
  /* the full beard is what makes him recognisable */
  '<path d="M17.2 22.5c0 13 5 20.5 10.8 20.5s10.8-7.5 10.8-20.5c-1.6 5-5.2 7.5-10.8 7.5' +
  's-9.2-2.5-10.8-7.5z" fill="#2a201a"/>' +
  '<circle cx="23.4" cy="21" r="1.5" fill="#2a201a"/>' +
  '<circle cx="32.6" cy="21" r="1.5" fill="#2a201a"/>' +
  '</svg>';

/* π in colour — drawn rather than relying on an emoji, since there is
   no pi emoji at all. */
var ART_PI =
  '<svg viewBox="0 0 56 56" role="img" aria-label="פאי">' +
  '<defs><linearGradient id="pig" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="#3987e5"/><stop offset="0.55" stop-color="#d55181"/>' +
  '<stop offset="1" stop-color="#c98500"/></linearGradient></defs>' +
  '<text x="28" y="44" text-anchor="middle" font-size="46" font-weight="700"' +
  ' font-family="Georgia,\'Times New Roman\',serif" fill="url(#pig)">π</text>' +
  '</svg>';

var FLAG_IL =
  '<svg viewBox="0 0 66 48" role="img" aria-label="דגל ישראל">' +
  '<rect width="66" height="48" rx="3" fill="#fff"/>' +
  '<rect y="6" width="66" height="6" fill="#0038b8"/>' +
  '<rect y="36" width="66" height="6" fill="#0038b8"/>' +
  '<path d="M33 16 L40.5 29 L25.5 29 Z M33 32 L25.5 19 L40.5 19 Z" ' +
  'fill="none" stroke="#0038b8" stroke-width="2.4"/>' +
  '</svg>';

window.DAYS = {

  /* ---------- Israeli / Jewish (top priority) ----------
     `off: true` marks a day when school is closed (Ministry of Education
     vacation calendar). The board skips those: with nobody in the
     building there is nothing to announce, and the pane would only be
     shown to an empty corridor. Because these are Hebrew-calendar dates,
     the flag needs no yearly maintenance. */
  israeli: [
    { heb: "Tishri-1",   icon: "🍎", title: "ראש השנה", off: true },
    { heb: "Tishri-10",  icon: "🕍", title: "יום הכיפורים", off: true },
    { heb: "Tishri-15",  icon: "🌿", title: "סוכות", off: true },
    { heb: "Tishri-22",  icon: "📖", title: "שמחת תורה", off: true },
    { heb: "Heshvan-7",  icon: "✈️", title: "יום העלייה" },
    { heb: "Heshvan-12", icon: "🕯️", title: "יום הזיכרון לרצח יצחק רבין" },
    { heb: "Heshvan-29", svg: ART_JERUSALEM, title: "חג הסיגד" },
    { heb: "Kislev-25",  icon: "🕎", title: "חנוכה", off: true },
    { heb: "Tevet-21",   icon: "🔤", title: "יום הלשון העברית" },
    { heb: "Shevat-15",  icon: "🌳", title: "ט״ו בשבט" },
    { heb: "Shevat-30",  icon: "👨‍👩‍👧", title: "יום המשפחה" },
    { heb: "Adar-7",     icon: "🕯️", title: "יום הזיכרון לחללים שמקום קבורתם לא נודע" },
    { heb: "Adar-14",    icon: "🎭", title: "פורים", off: true },
    { heb: "Nisan-15",   icon: "🍷", title: "פסח", off: true },
    { heb: "Nisan-27",   icon: "🕯️", title: "יום הזיכרון לשואה ולגבורה" },
    { heb: "Iyar-4",     icon: "🕯️", title: "יום הזיכרון לחללי מערכות ישראל" },
    /* school is closed on Independence Day, so this entry never reaches
       the screen — it stays in the list so that an international day
       falling on the same date is suppressed too (Earth Day can) */
    { heb: "Iyar-5",     svg: FLAG_IL, title: "יום העצמאות", off: true },
    { heb: "Iyar-10",    svg: ART_HERZL, title: "יום הרצל" },
    { heb: "Iyar-18",    icon: "🔥", title: "ל״ג בעומר" },
    { heb: "Iyar-28",    svg: ART_JERUSALEM, title: "יום ירושלים" },
    { heb: "Sivan-6",    icon: "🌾", title: "שבועות", off: true },
    /* both fall inside the summer vacation */
    { heb: "Tamuz-29",   icon: "📕", title: "יום הזיכרון לזאב ז׳בוטינסקי", off: true },
    { heb: "Av-9",       icon: "🕯️", title: "תשעה באב", off: true }
  ],

  /* ---------- International (used only if no Israeli day) ---------- */
  international: [
    { greg: "01-27", icon: "🕯️", title: "היום הבינלאומי לזכר קורבנות השואה" },
    { greg: "02-11", icon: "🔬", title: "היום הבינלאומי לנשים ולנערות במדע" },
    { greg: "02-21", icon: "🗣️", title: "היום הבינלאומי לשפת האם" },
    { greg: "03-08", icon: "👩", title: "יום האישה הבינלאומי" },
    { greg: "03-14", svg: ART_PI, title: "יום הפאי" },
    { greg: "03-20", icon: "🌱", title: "יום האביב הבינלאומי" },
    { greg: "03-21", icon: "🤝", title: "היום הבינלאומי למאבק בגזענות" },
    { greg: "04-02", icon: "🧩", title: "היום הבינלאומי למודעות לאוטיזם" },
    { greg: "04-07", icon: "🏃", title: "היום הבינלאומי לספורט" },
    { greg: "04-22", icon: "🌍", title: "יום כדור הארץ" },
    { greg: "04-23", icon: "📚", title: "יום הספר הבינלאומי" },
    { greg: "05-03", icon: "📰", title: "היום הבינלאומי לחופש העיתונות" },
    { greg: "05-17", icon: "💻", title: "היום הבינלאומי לאינטרנט" },
    { greg: "06-05", icon: "🌳", title: "יום הסביבה הבינלאומי" },
    { greg: "06-08", icon: "🌊", title: "יום האוקיינוסים הבינלאומי" },
    { greg: "09-08", icon: "✍️", title: "היום הבינלאומי לאוריינות" },
    { greg: "09-21", icon: "🕊️", title: "היום הבינלאומי לשלום" },
    { greg: "10-01", icon: "🎵", title: "יום המוזיקה הבינלאומי" },
    { greg: "10-05", icon: "🎓", title: "יום המורה הבינלאומי" },
    { greg: "10-24", icon: "🌐", title: "יום האומות המאוחדות" },
    { greg: "11-10", icon: "🔭", title: "היום הבינלאומי למדע" },
    { greg: "11-16", icon: "🤲", title: "היום הבינלאומי לסובלנות" },
    { greg: "11-20", icon: "🧒", title: "יום זכויות הילד הבינלאומי" },
    { greg: "12-03", icon: "♿", title: "היום הבינלאומי לאנשים עם מוגבלות" },
    { greg: "12-10", icon: "⚖️", title: "יום זכויות האדם הבינלאומי" }
  ]
};
