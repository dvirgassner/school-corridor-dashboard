/* ==================================================================
   config.js — the only file you edit to point the board at a sheet.

   DEMO MODE:  sheets = null  → the board shows the bundled sample data
                               from sample-data.js and pins the clock to
                               08:10 so the full-day logic is visible.
   LIVE MODE:  fill in the four CSV URLs below.

   How to get the URLs (see sheet-template/README.md for screenshots):
     Google Sheet → File → Share → Publish to web
     → choose a tab → "Comma-separated values (.csv)" → Publish
     → copy the link. Repeat for all four tabs.
   ================================================================== */
window.DASH_CONFIG = {
  sheets: null,
  /* Example of live mode — replace the whole `sheets: null` above with:
  sheets: {
    schedule: "https://docs.google.com/spreadsheets/d/e/XXXX/pub?gid=0&single=true&output=csv",
    exams:    "https://docs.google.com/spreadsheets/d/e/XXXX/pub?gid=1&single=true&output=csv",
    events:   "https://docs.google.com/spreadsheets/d/e/XXXX/pub?gid=2&single=true&output=csv",
    messages: "https://docs.google.com/spreadsheets/d/e/XXXX/pub?gid=3&single=true&output=csv"
  },
  */

  refreshSeconds: 60,        /* how often to re-read the sheet        */
  staleMinutes: 10,          /* stamp turns amber after this long     */
  videoIntervalMinutes: 10,  /* minimum gap between video plays       */
  schoolName: "תיכון השיטה"
};
