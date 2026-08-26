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

/* Theodor Herzl — the Wikimedia Commons stencil portrait, which is an
   actual likeness rather than my approximation of one. Two hand-drawn
   attempts read as "a bearded cleric" instead of as him; a traced
   photograph does not have that problem.

   LICENCE: CC BY-SA 4.0 by AlkTheShadow. Attribution is required and the
   file stays under that licence — see CREDITS.md. It is kept as its own
   file in vendor/ rather than inlined here, so the licensed asset stays
   identifiable instead of dissolving into this one.

   The source is black on transparent, which would vanish on the dark
   themes; inverting it produces a photographic negative. So it sits on a
   light plate instead and reads as a portrait on every theme. */
var ART_HERZL =
  '<span class="portrait"><img src="vendor/herzl.svg" alt="בנימין זאב הרצל"></span>';

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

/* A girl and a boy, for children's rights. The girl's hair is one
   rounded mass behind the head and past the jaw — an earlier version
   drew two side tufts, which at this size read as horns. */
var ART_CHILDREN =
  '<svg viewBox="0 0 72 56" role="img" aria-label="ילדה וילד">' +
  '<path d="M20 3c7.2 0 11.4 4.6 11.4 11.6 0 4.6-.6 8.4-1.8 11.4h-3.2' +
  'c1.2-2.4 1.8-5.2 1.8-8.4 0-1.6-.3-2.9-.9-3.9-2 1.2-4.4 1.8-7.3 1.8' +
  's-5.3-.6-7.3-1.8c-.6 1-.9 2.3-.9 3.9 0 3.2.6 6 1.8 8.4h-3.2' +
  'c-1.2-3-1.8-6.8-1.8-11.4C8.6 7.6 12.8 3 20 3z" fill="#7a4a2b"/>' +
  '<circle cx="20" cy="15.5" r="8.6" fill="#e8b98f"/>' +
  '<path d="M11.4 14.6c0-5.6 2.9-8.4 8.6-8.4s8.6 2.8 8.6 8.4c-2-2.2-4.9-3.3-8.6-3.3' +
  's-6.6 1.1-8.6 3.3z" fill="#7a4a2b"/>' +
  '<path d="M20 26c6 0 10 4 11.5 12l1.5 15H7l1.5-15C10 30 14 26 20 26z" fill="#e0468c"/>' +
  '<circle cx="52" cy="15" r="8.6" fill="#d9a06a"/>' +
  '<path d="M43.4 14a8.6 8.6 0 0 1 17.2 0c-2.4-2.4-5.2-3.5-8.6-3.5s-6.2 1.1-8.6 3.5z" ' +
  'fill="#2f2a24"/>' +
  '<path d="M52 26c5.5 0 9 3 9.5 9l.5 6h-4l-1 12h-10l-1-12h-4l.5-6c.5-6 4-9 9.5-9z" ' +
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

/* The internet: a globe with signal arcs coming off it. Not a laptop —
   that is a thing you use to reach the internet, a different idea that
   also dates badly. And not a globe ringed with dots, which was the
   first attempt: dots on curved paths around a centre read as electrons
   around a nucleus, so it looked like an atom. The arcs say "connected"
   without any orbiting parts to misread. */
var ART_INTERNET =
  '<svg viewBox="0 0 66 56" role="img" aria-label="אינטרנט">' +
  '<g fill="none" stroke="#3987e5" stroke-width="3.2" stroke-linecap="round">' +
  '<circle cx="26" cy="30" r="19"/><path d="M7 30h38"/>' +
  '<path d="M26 11c6.2 6.5 6.2 31.5 0 38M26 11c-6.2 6.5-6.2 31.5 0 38"/></g>' +
  '<g fill="none" stroke="#1fa3b5" stroke-width="3.2" stroke-linecap="round">' +
  '<path d="M50 22a13 13 0 0 1 0 16"/><path d="M56.5 15a22 22 0 0 1 0 30"/></g>' +
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
