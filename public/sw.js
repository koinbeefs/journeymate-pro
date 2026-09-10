// Intellitravel service worker — app shell + tiles + routing caches.
const VERSION = "Intellitravel-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const TILE_CACHE = `${VERSION}-tiles`;
const OSRM_CACHE = `${VERSION}-osrm`;
const GEO_CACHE = `${VERSION}-geo`;
const API_CACHE = `${VERSION}-api`;
const TILE_MAX = 500; // LRU cap
const OSRM_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const SHELL = [
  "/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).catch(() => { }));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// LRU trim: drop oldest half when we exceed the cap.
async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= max) return;
  const drop = keys.length - Math.floor(max * 0.75);
  for (let i = 0; i < drop; i++) await cache.delete(keys[i]);
}

function isTileRequest(url) {
  return (
    /tile\.openstreetmap\.org/.test(url.host) ||
    /basemaps\.cartocdn\.com/.test(url.host) ||
    /server\.arcgisonline\.com/.test(url.host) ||
    /tile\.opentopomap\.org/.test(url.host)
  );
}

function isRoutingRequest(url) {
  return (
    /router\.project-osrm\.org/.test(url.host) ||
    /\/api\/route\/calculate/.test(url.pathname) ||
    /\/api\/trips\/.*\/route-details/.test(url.pathname)
  );
}

function isGeocodeRequest(url) {
  return /nominatim\.openstreetmap\.org/.test(url.host) || /api\.geoapify\.com/.test(url.host);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Navigations — network-first, fall back to cached shell for offline SPA boot.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => { });
          return res;
        })
        .catch(() => caches.match("/index.html").then((r) => r || caches.match("/")))
    );
    return;
  }

  // Map tiles — stale-while-revalidate with LRU cap.
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              cache.put(req, res.clone()).then(() => trimCache(TILE_CACHE, TILE_MAX)).catch(() => { });
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Routing requests — network-first, fall back to OSRM_CACHE for offline use.
  if (isRoutingRequest(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(OSRM_CACHE).then((c) => c.put(req, copy)).catch(() => { });
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Geocoding — network-first, fall back to cache.
  if (isGeocodeRequest(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(GEO_CACHE).then((c) => c.put(req, copy)).catch(() => { });
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Backend API calls (other than routing) — Network-first into API_CACHE (prevents polluting SHELL_CACHE)
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(API_CACHE).then((c) => c.put(req, copy)).catch(() => { });
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Same-origin static assets — stale-while-revalidate.
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => { });
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
