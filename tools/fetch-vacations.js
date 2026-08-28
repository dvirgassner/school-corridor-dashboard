#!/usr/bin/env node
/* ==================================================================
   fetch-vacations.js — regenerate dashboard/vacations.js from the
   Ministry of Education's published vacation feed.

   Why a build step rather than a fetch from the board itself: the feed
   sends no CORS headers, so a page on GitHub Pages cannot read it. The
   board therefore ships the dates as a plain script from its own origin,
   and this tool refreshes them. A GitHub Action runs it weekly, so the
   calendar keeps itself up to date without anyone remembering to.

   Run: node tools/fetch-vacations.js [path-to-local.ics]
   ================================================================== */
const fs = require("fs");
const path = require("path");

const FEED = "https://parents.education.gov.il/api/data/" +
             "luachChufshotBeforeLogin/getChufshotLegmail?migzar=2";
const OUT = path.join(__dirname, "..", "dashboard", "vacations.js");

/* The feed carries one malformed entry: a "חופשת קיץ" that runs from
   last August to the September AFTER next — over a year long. Taken at
   face value it would mark every single school day as a vacation and
   blank the board permanently, so any range longer than this is
   rejected. A real summer break is about 72 days, so the cap has plenty
   of room while still catching the bad record. */
const MAX_DAYS = 100;

function parseIcs(text) {
  const out = [];
  const blocks = text.replace(/\r/g, "").split("BEGIN:VEVENT").slice(1);
  for (const b of blocks) {
    const get = (k) => {
      const m = new RegExp("^" + k + "[^:\n]*:(.+)$", "m").exec(b);
      return m ? m[1].trim() : null;
    };
    const summary = get("SUMMARY");
    const start = get("DTSTART");
    const end = get("DTEND");
    if (!summary || !start || !end) continue;
    const iso = (s) => s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8);
    /* DTEND on an all-day event is EXCLUSIVE — the morning after the
       last day off. The board wants the last day itself. */
    const last = new Date(iso(end) + "T12:00:00");
    last.setDate(last.getDate() - 1);
    const from = iso(start);
    const to = last.getFullYear() + "-" +
      String(last.getMonth() + 1).padStart(2, "0") + "-" +
      String(last.getDate()).padStart(2, "0");
    const days = Math.round(
      (new Date(to + "T12:00:00") - new Date(from + "T12:00:00")) / 864e5) + 1;
    if (days < 1) continue;
    if (days > MAX_DAYS) {
      console.warn(`  skipped "${summary}" — ${days} days, over the ${MAX_DAYS}-day cap`);
      continue;
    }
    out.push({ from, to, title: summary });
  }
  out.sort((a, b) => a.from < b.from ? -1 : 1);
  return out;
}

async function main() {
  const local = process.argv[2];
  let text;
  if (local) {
    text = fs.readFileSync(local, "utf8");
    console.log("read " + local);
  } else {
    const r = await fetch(FEED);
    if (!r.ok) throw new Error("feed returned HTTP " + r.status);
    text = await r.text();
    console.log("fetched the ministry feed");
  }
  const list = parseIcs(text);
  if (!list.length) throw new Error("no usable events — refusing to write an empty file");

  /* The school year the feed describes ends in the year of its last
     entry (Shavuot, in June). Deriving the summer year from that keeps
     this file correct after next year's refresh instead of quietly
     ageing into the past.

     Summer starts on 20 June because this is a HIGH school; elementary
     schools run to 1 July. Change the date here if the board is ever
     reused for a younger school. */
  const summerYear = Number(list[list.length - 1].to.slice(0, 4));

  const rows = list.map((v) =>
    `  { from: "${v.from}", to: "${v.to}", title: ${JSON.stringify(v.title)} }`
  ).join(",\n");

  const body = `/* ==================================================================
   vacations.js — days the school is closed. GENERATED FILE, do not edit
   by hand: run \`node tools/fetch-vacations.js\` instead, or let the
   weekly GitHub Action do it.

   Source: the Ministry of Education's public vacation feed. Dates are
   inclusive on both ends, in the board's own YYYY-MM-DD form.

   On any date covered here the board shows only the header and a notice
   naming the vacation — no schedule, no agenda, no messages.
   ================================================================== */
window.VACATIONS = [
${rows},
  /* Summer. The feed's own summer record is malformed — a 369-day range
     that would blank the board for a year — so it is rejected there and
     rebuilt here. 20 June is the high-school end of year; elementary
     schools run to 1 July. */
  { from: "${summerYear}-06-20", to: "${summerYear}-08-31", title: "חופשת הקיץ" }
];
`;
  fs.writeFileSync(OUT, body, "utf8");
  console.log(`wrote ${OUT} — ${list.length} ranges from the feed, plus summer`);
  list.forEach((v) => console.log(`  ${v.from} → ${v.to}  ${v.title}`));
}

main().catch((e) => { console.error("FAILED: " + e.message); process.exit(1); });
