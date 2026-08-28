/* ==================================================================
   vacations.js — days the school is closed. GENERATED FILE, do not edit
   by hand: run `node tools/fetch-vacations.js` instead, or let the
   weekly GitHub Action do it.

   Source: the Ministry of Education's public vacation feed. Dates are
   inclusive on both ends, in the board's own YYYY-MM-DD form.

   On any date covered here the board shows only the header and a notice
   naming the vacation — no schedule, no agenda, no messages.
   ================================================================== */
window.VACATIONS = [
  { from: "2026-09-11", to: "2026-09-13", title: "ראש השנה" },
  { from: "2026-09-20", to: "2026-09-21", title: "יום כיפור" },
  { from: "2026-09-22", to: "2026-10-03", title: "סוכות" },
  { from: "2026-12-06", to: "2026-12-12", title: "חופשת חנוכה" },
  { from: "2027-03-23", to: "2027-03-24", title: "פורים" },
  { from: "2027-04-13", to: "2027-04-28", title: "פסח" },
  { from: "2027-05-12", to: "2027-05-12", title: "יום העצמאות" },
  { from: "2027-06-10", to: "2027-06-11", title: "שבועות" },
  /* Summer. The feed's own summer record is malformed — a 369-day range
     that would blank the board for a year — so it is rejected there and
     rebuilt here. 20 June is the high-school end of year; elementary
     schools run to 1 July. */
  { from: "2027-06-20", to: "2027-08-31", title: "חופשת הקיץ" }
];
