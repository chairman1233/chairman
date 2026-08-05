/* Network-first: always try for the freshest app, fall back to cache when offline. */
const CACHE = "chairman-v59";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(k => Promise.all(k.map(n => n !== CACHE && caches.delete(n))))
    .then(() => self.clients.claim())
));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== location.origin) return;   // never cache API calls
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const r = await fetch(e.request);
      c.put(e.request, r.clone());
      return r;
    } catch (err) {
      return (await c.match(e.request)) || (await c.match("./index.html")) || Response.error();
    }
  })());
});
