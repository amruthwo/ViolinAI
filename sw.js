/* sw.js — v15.5.3 */
const CACHE = "violinai-v15.6";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js?v=15.5.3",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE) ? null : caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (url.origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // Do NOT ignore query strings for versioned assets like app.js?v=...
    const isVersionedAsset =
      url.pathname.endsWith("/app.js") ||
      url.pathname.endsWith("/styles.css") ||
      url.pathname.endsWith("/manifest.webmanifest") ||
      url.pathname.includes("/icons/");

    const cached = await cache.match(req, { ignoreSearch: !isVersionedAsset });
    if (cached) return cached;

    try {
      const res = await fetch(req);
      if (req.method === "GET" && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      if (req.mode === "navigate") {
        const fallback = await cache.match("./index.html", { ignoreSearch: true });
        if (fallback) return fallback;
      }
      throw e;
    }
  })());
});
