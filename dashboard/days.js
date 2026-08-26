/* ==================================================================
   days.js — "day of the day" calendar.

   Two curated lists, checked in this order:
     1. ISRAELI — official Israeli days and Jewish holidays. Most are
        fixed to the HEBREW calendar, so they are keyed by Hebrew
        month + day and land correctly every year without maintenance.
        A few are Gregorian-fixed and keyed that way.
     2. INTERNATIONAL — Gregorian, used only when no Israeli day falls
        on that date.

   Icons are either an emoji or an inline SVG — never a hosted image.
   Both travel inside this file, so the board keeps its icons with the
   network down. SVG is used wherever an emoji would be wrong: no emoji
   exists for the thing (π), the emoji renders as text on some font
   stacks (the flag), or the available emoji carries the wrong meaning
   (a laptop for the internet, one family shape for all families).

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
/* Old Jerusalem as its Jewish-era fortifications: crenellated walls, a
   tall citadel tower, a second tower, and a gate. No dome — the Dome of
   the Rock is an Umayyad building and the wrong emblem for either of the
   days this marks. Used for both יום ירושלים and חג הסיגד, whose prayer
   is directed towards Jerusalem. */
var ART_JERUSALEM =
  '<svg viewBox="0 0 84 56" role="img" aria-label="ירושלים העתיקה">' +
  /* the smaller tower */
  '<rect x="60" y="16" width="17" height="35" fill="#c9b787"/>' +
  '<g fill="#c9b787"><rect x="60" y="12" width="4.5" height="5"/>' +
  '<rect x="66.2" y="12" width="4.5" height="5"/><rect x="72.4" y="12" width="4.5" height="5"/></g>' +
  '<rect x="65" y="26" width="5" height="9" fill="#6f5f45"/>' +
  /* the tall citadel, which is what makes the skyline read as Jerusalem */
  '<rect x="9" y="8" width="19" height="43" fill="#e3d6b0"/>' +
  '<g fill="#e3d6b0"><rect x="9" y="3.5" width="5" height="5"/>' +
  '<rect x="16" y="3.5" width="5" height="5"/><rect x="23" y="3.5" width="5" height="5"/></g>' +
  '<rect x="15.5" y="17" width="6" height="10" fill="#6f5f45"/>' +
  /* the wall between them, crenellated along its length */
  '<rect x="6" y="32" width="72" height="19" fill="#d9cba3"/>' +
  '<g fill="#d9cba3">' +
  '<rect x="6" y="27.5" width="6.5" height="5"/><rect x="17" y="27.5" width="6.5" height="5"/>' +
  '<rect x="28" y="27.5" width="6.5" height="5"/><rect x="39" y="27.5" width="6.5" height="5"/>' +
  '<rect x="50" y="27.5" width="6.5" height="5"/><rect x="61" y="27.5" width="6.5" height="5"/>' +
  '<rect x="71.5" y="27.5" width="6.5" height="5"/></g>' +
  '<path d="M36 51V43a7 7 0 0 1 14 0v8z" fill="#5a4a34"/>' +
  '</svg>';

/* Theodor Herzl. The three things that make him recognisable at this size
   are the high forehead with hair only at the temples, the long
   square-cut beard reaching the chest, and the formal dark coat with a
   white shirt. An earlier version put the hair across the crown and cut
   the beard short and round, which read as a cleric rather than as him —
   the silhouette does all the work here, so those proportions matter. */
var ART_HERZL =
  '<svg viewBox="0 0 56 62" role="img" aria-label="בנימין זאב הרצל">' +
  '<path d="M4 62c0-11.5 9.5-17 24-17s24 5.5 24 17z" fill="#2f3a49"/>' +
  '<path d="M20 46h16l-4 10h-8z" fill="#f4f1e8"/>' +
  '<path d="M24.6 46.8h6.8l-1.3 5h-4.2z" fill="#1d232d"/>' +
  '<path d="M28 8c7.2 0 11.6 4.8 11.6 13 0 8-4.2 14-11.6 14s-11.6-6-11.6-14C16.4 12.8 20.8 8 28 8z"' +
  ' fill="#e8c9a6"/>' +
  '<path d="M16.6 24c-1.4-6.6-.6-11 2.4-13.4-.8 4-.6 8 .6 12z" fill="#241b15"/>' +
  '<path d="M39.4 24c1.4-6.6.6-11-2.4-13.4.8 4 .6 8-.6 12z" fill="#241b15"/>' +
  '<path d="M18.2 13.4C20.4 9.4 23.6 7.4 28 7.4s7.6 2 9.8 6c-2.8-2.4-6.1-3.6-9.8-3.6' +
  's-7 1.2-9.8 3.6z" fill="#241b15"/>' +
  '<path d="M21.4 20.6h4.6M30 20.6h4.6" stroke="#241b15" stroke-width="2" stroke-linecap="round"/>' +
  '<circle cx="23.7" cy="24.2" r="1.6" fill="#241b15"/>' +
  '<circle cx="32.3" cy="24.2" r="1.6" fill="#241b15"/>' +
  '<path d="M16.8 25c-.4 5 0 9.4 1.2 13.2 1.2 3.8 2.6 6.6 4.2 8.4 1.6 1.8 3.5 2.7 5.8 2.7' +
  's4.2-.9 5.8-2.7c1.6-1.8 3-4.6 4.2-8.4 1.2-3.8 1.6-8.2 1.2-13.2-.9 5.2-2.6 8.4-5.2 9.6' +
  '-1.8.9-3.8 1.3-6 1.3s-4.2-.4-6-1.3c-2.6-1.2-4.3-4.4-5.2-9.6z" fill="#1c1510"/>' +
  '<path d="M24.4 27.8h7.2c-.6 1.8-1.8 2.7-3.6 2.7s-3-.9-3.6-2.7z" fill="#1c1510"/>' +
  '<path d="M23.6 33.4c1.4.5 2.9.8 4.4.8s3-.3 4.4-.8" stroke="#2f241c" stroke-width="1.4"' +
  ' fill="none"/>' +
  '</svg>';

/* Science, as the three school subjects it means here: a DNA strand for
   biology, a flask for chemistry, an atom for physics. Three marks side
   by side rather than one composite — at this size a composite turns to
   mush, whereas three distinct silhouettes each stay readable. */
var ART_SCIENCE =
  '<svg viewBox="0 0 108 56" role="img" aria-label="ביולוגיה, כימיה ופיזיקה">' +
  '<g stroke="#2f9e00" stroke-width="3.4" fill="none" stroke-linecap="round">' +
  '<path d="M8 6c14 8 14 16 0 24s-14 16 0 20"/>' +
  '<path d="M26 6c-14 8-14 16 0 24s14 16 0 20"/>' +
  '<path d="M11 13h12M10.5 25h13M11 39h12"/></g>' +
  '<g transform="translate(38 0)">' +
  '<path d="M13 5v13L3 45a3 3 0 0 0 2.8 4h20.4A3 3 0 0 0 29 45L19 18V5z" ' +
  'fill="none" stroke="#3987e5" stroke-width="3.4" stroke-linejoin="round"/>' +
  '<path d="M7.4 33h17.2l4.4 12a3 3 0 0 1-2.8 4H5.8A3 3 0 0 1 3 45z" fill="#3987e5"/>' +
  '<path d="M10 3h12" stroke="#3987e5" stroke-width="3.4" stroke-linecap="round"/></g>' +
  '<g transform="translate(74 28)" stroke="#e8558f" stroke-width="3.2" fill="none">' +
  '<ellipse rx="16" ry="6.4"/><ellipse rx="16" ry="6.4" transform="rotate(60)"/>' +
  '<ellipse rx="16" ry="6.4" transform="rotate(-60)"/>' +
  '<circle r="4" fill="#e8558f" stroke="none"/></g>' +
  '</svg>';

/* A girl and a boy, for children's rights. */
var ART_CHILDREN =
  '<svg viewBox="0 0 72 56" role="img" aria-label="ילדה וילד">' +
  '<circle cx="20" cy="14" r="9" fill="#e8b98f"/>' +
  '<path d="M11 14a9 9 0 0 1 18 0c0-6-3-9-9-9s-9 3-9 9z" fill="#7a4a2b"/>' +
  '<path d="M11.5 15c-1.6 0-2.5-2-2.2-5M28.5 15c1.6 0 2.5-2 2.2-5" ' +
  'stroke="#7a4a2b" stroke-width="3" fill="none" stroke-linecap="round"/>' +
  '<path d="M20 25c6 0 10 4 11.5 12l1.5 15H7l1.5-15C10 29 14 25 20 25z" fill="#e0468c"/>' +
  '<circle cx="52" cy="14" r="9" fill="#d9a06a"/>' +
  '<path d="M43 13a9 9 0 0 1 18 0c-2.5-2.5-5.4-3.6-9-3.6s-6.5 1.1-9 3.6z" fill="#2f2a24"/>' +
  '<path d="M52 25c5.5 0 9 3 9.5 9L62 40h-4l-1 12h-10l-1-12h-4l.5-6c.5-6 4-9 9.5-9z" ' +
  'fill="#3987e5"/>' +
  '</svg>';

/* Hebrew language day: the letters themselves. An A-B-C glyph says
   "alphabet" but not "Hebrew"; א״ב says both, and is the actual Hebrew
   word for an alphabet. */
var ART_HEBREW =
  '<svg viewBox="0 0 76 56" role="img" aria-label="א״ב">' +
  '<defs><linearGradient id="hebg" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="#3987e5"/><stop offset="1" stop-color="#1fa3b5"/>' +
  '</linearGradient></defs>' +
  '<text x="38" y="46" text-anchor="middle" font-size="50" font-weight="700"' +
  ' font-family="\'Noto Sans Hebrew\',sans-serif" fill="url(#hebg)">א״ב</text></svg>';

/* Family day. Four figures of different heights and no gender markers —
   a family is not one arrangement, and a corridor board should not tell
   a child whose household is a different shape that theirs is not one. */
var ART_FAMILY =
  '<svg viewBox="0 0 88 56" role="img" aria-label="משפחה">' +
  '<circle cx="14" cy="16" r="8" fill="#9085e9"/>' +
  '<path d="M14 26c7 0 11 4.5 11 12v14H3V38c0-7.5 4-12 11-12z" fill="#9085e9"/>' +
  '<circle cx="36" cy="13" r="9" fill="#1fa3b5"/>' +
  '<path d="M36 24c7.5 0 12 5 12 13.5V52H24V37.5C24 29 28.5 24 36 24z" fill="#1fa3b5"/>' +
  '<circle cx="57" cy="27" r="6.5" fill="#c98500"/>' +
  '<path d="M57 35c5 0 8 3.2 8 9v8H49v-8c0-5.8 3-9 8-9z" fill="#c98500"/>' +
  '<circle cx="76" cy="31" r="5.5" fill="#e8558f"/>' +
  '<path d="M76 38c4.2 0 6.8 2.8 6.8 7.6V52H69.2v-6.4c0-4.8 2.6-7.6 6.8-7.6z" fill="#e8558f"/>' +
  '</svg>';

/* The internet as a network, not as a device: a wired globe with nodes
   on it. A laptop is a thing you use to reach the internet, which is a
   different idea and dates badly besides. */
var ART_INTERNET =
  '<svg viewBox="0 0 56 56" role="img" aria-label="אינטרנט">' +
  '<g fill="none" stroke="#3987e5" stroke-width="3">' +
  '<circle cx="28" cy="28" r="21"/><path d="M7 28h42"/>' +
  '<path d="M28 7c6.5 7 6.5 35 0 42M28 7c-6.5 7-6.5 35 0 42"/>' +
  '<path d="M11.5 16c4.8 3.2 10.3 4.8 16.5 4.8S39.7 19.2 44.5 16"/>' +
  '<path d="M11.5 40c4.8-3.2 10.3-4.8 16.5-4.8s11.7 1.6 16.5 4.8"/></g>' +
  '<g fill="#1fa3b5">' +
  '<circle cx="28" cy="7" r="4.6"/><circle cx="7" cy="28" r="4.6"/>' +
  '<circle cx="49" cy="28" r="4.6"/><circle cx="28" cy="49" r="4.6"/>' +
  '<circle cx="28" cy="28" r="4.2"/></g>' +
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

/* Inline SVG of the Israeli flag. An emoji flag (🇮🇱) is NOT usable here:
   Windows and several Linux font stacks render country-flag sequences as
   the two letters "IL" instead of a flag, so the board would show text
   where a flag belongs. Drawing it is the only portable answer. */
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
    { heb: "Tevet-21",   svg: ART_HEBREW, title: "יום הלשון העברית" },
    { heb: "Shevat-15",  icon: "🌳", title: "ט״ו בשבט" },
    { heb: "Shevat-30",  svg: ART_FAMILY, title: "יום המשפחה" },
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
    { greg: "03-08", icon: "👩", title: "יום האישה הבינלאומי" },
    { greg: "03-14", svg: ART_PI, title: "יום הפאי" },
    { greg: "03-20", icon: "🌱", title: "יום האביב הבינלאומי" },
    { greg: "03-21", icon: "🤝", title: "היום הבינלאומי למאבק בגזענות" },
    { greg: "04-02", icon: "🧩", title: "היום הבינלאומי למודעות לאוטיזם" },
    { greg: "04-07", icon: "🏃", title: "היום הבינלאומי לספורט" },
    { greg: "04-22", icon: "🌍", title: "יום כדור הארץ" },
    { greg: "04-23", icon: "📚", title: "יום הספר הבינלאומי" },
    { greg: "05-03", icon: "📰", title: "היום הבינלאומי לחופש העיתונות" },
    { greg: "05-17", svg: ART_INTERNET, title: "היום הבינלאומי לאינטרנט" },
    { greg: "06-05", icon: "🌳", title: "יום הסביבה הבינלאומי" },
    { greg: "06-08", icon: "🌊", title: "יום האוקיינוסים הבינלאומי" },
    { greg: "09-08", icon: "✍️", title: "היום הבינלאומי לאוריינות" },
    { greg: "09-21", icon: "🕊️", title: "היום הבינלאומי לשלום" },
    { greg: "10-01", icon: "🎵", title: "יום המוזיקה הבינלאומי" },
    { greg: "10-05", icon: "🎓", title: "יום המורה הבינלאומי" },
    { greg: "10-24", icon: "🌐", title: "יום האומות המאוחדות" },
    { greg: "11-10", svg: ART_SCIENCE, title: "היום הבינלאומי למדע" },
    { greg: "11-16", icon: "🤲", title: "היום הבינלאומי לסובלנות" },
    { greg: "11-20", svg: ART_CHILDREN, title: "יום זכויות הילד הבינלאומי" },
    { greg: "12-03", icon: "♿", title: "היום הבינלאומי לאנשים עם מוגבלות" },
    { greg: "12-10", icon: "⚖️", title: "יום זכויות האדם הבינלאומי" }
  ]
};
