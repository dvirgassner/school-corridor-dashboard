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
window.DAYS = {

  /* ---------- Israeli / Jewish (top priority) ---------- */
  israeli: [
    /* Hebrew-calendar dated */
    { heb: "Tishri-1",   icon: "🍎", title: "ראש השנה" },
    { heb: "Tishri-10",  icon: "🕍", title: "יום הכיפורים" },
    { heb: "Tishri-15",  icon: "🌿", title: "סוכות" },
    { heb: "Tishri-22",  icon: "📖", title: "שמחת תורה" },
    { heb: "Heshvan-7",  icon: "✈️", title: "יום העלייה" },
    { heb: "Heshvan-12", icon: "🕯️", title: "יום הזיכרון לרצח יצחק רבין" },
    { heb: "Heshvan-29", icon: "🌍", title: "חג הסיגד" },
    { heb: "Kislev-25",  icon: "🕎", title: "חנוכה" },
    { heb: "Tevet-21",   icon: "🔤", title: "יום הלשון העברית" },
    { heb: "Shevat-15",  icon: "🌳", title: "ט״ו בשבט" },
    { heb: "Shevat-30",  icon: "👨‍👩‍👧", title: "יום המשפחה" },
    { heb: "Adar-14",    icon: "🎭", title: "פורים" },
    { heb: "Adar-7",     icon: "📜", title: "יום הזיכרון לחללי מערכות ישראל שמקום קבורתם לא נודע" },
    { heb: "Nisan-15",   icon: "🍷", title: "פסח" },
    { heb: "Nisan-27",   icon: "🕯️", title: "יום הזיכרון לשואה ולגבורה" },
    { heb: "Iyar-4",     icon: "🕯️", title: "יום הזיכרון לחללי מערכות ישראל" },
    { heb: "Iyar-5",     icon: "🇮🇱", title: "יום העצמאות" },
    { heb: "Iyar-10",    icon: "🎩", title: "יום הרצל" },
    { heb: "Iyar-18",    icon: "🔥", title: "ל״ג בעומר" },
    { heb: "Iyar-28",    icon: "🕌", title: "יום ירושלים" },
    { heb: "Sivan-6",    icon: "🌾", title: "שבועות" },
    { heb: "Tamuz-29",   icon: "📕", title: "יום הזיכרון לזאב ז׳בוטינסקי" },
    { heb: "Av-9",       icon: "🕯️", title: "תשעה באב" }
  ],

  /* ---------- International (used only if no Israeli day) ---------- */
  international: [
    { greg: "01-27", icon: "🕯️", title: "היום הבינלאומי לזכר קורבנות השואה" },
    { greg: "02-11", icon: "🔬", title: "היום הבינלאומי לנשים ולנערות במדע" },
    { greg: "02-21", icon: "🗣️", title: "היום הבינלאומי לשפת האם" },
    { greg: "03-08", icon: "♀️", title: "יום האישה הבינלאומי" },
    { greg: "03-14", icon: "🥧", title: "יום הפאי (π)" },
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
