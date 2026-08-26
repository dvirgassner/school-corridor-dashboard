/* ==================================================================
   sw.js — service worker, so the board survives an internet outage.

   Without this, the running page survives an outage fine (it keeps its
   last data in localStorage), but a RESTART during one does not: the
   browser has to fetch index.html and friends over the network, and
   there is none. A power cut plus a dead line therefore left a blank
   screen — the exact combination a school is most likely to hit.

   Strategy: network-first, cache fallback.
     • online  → always the freshest copy, and the cache is refreshed
     • offline → the last copy that worked

   Network-first is deliberate. Cache-first would be faster but can pin a
   broken build on a wall for a fortnight, and a screen nobody can update
   remotely is a worse failure than a slow first paint.

   Only same-origin GETs are touched. Google Sheets requests pass
   straight through: their freshness is the app's business, and it
   already falls back to localStorage when they fail.
   ================================================================== */
const CACHE = "corridor-board-v1";

const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./config.js",
  "./days.js",
  "./sample-data.js",
  "./logic.js",
  "./app.js",
  "./vendor/papaparse.min.js",
  "./vendor/gveret-levin-hebrew.woff2",
  "./vendor/school-logo.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())   /* a miss must not block install */
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        /* keep a copy of anything that worked */
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((hit) => hit || caches.match("./index.html")))
  );
});
