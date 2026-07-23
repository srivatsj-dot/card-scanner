// Offline-capable service worker.
//  - Navigations (the HTML document) are NETWORK-FIRST, so a freshly deployed
//    app is never stuck behind a stale cached page; we fall back to cache only
//    when offline.
//  - Other same-origin GETs (hashed JS/CSS/images) are stale-while-revalidate.
//  - API calls are POST and pass straight through.
const CACHE = "card-o-rama-v3";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // don't touch cross-origin
  if (url.pathname.startsWith("/api/")) return; // never cache API

  const isNavigation = req.mode === "navigate" || req.destination === "document";

  if (isNavigation) {
    // Network-first: always try to load the latest page; cache as backup.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("/")))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
