// Service worker: offline-capable shell and data for the simulator.
// - Navigations: network first, cached shell as fallback (a new deploy shows up on reload).
// - Hashed build assets, fonts and icons: cache first (their URLs change when their content does).
// - /data/*: stale-while-revalidate (same URL across deploys; instant from cache, refreshed in background).
// Bump VERSION when the caching strategy changes.
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const STATIC = `static-${VERSION}`;
const DATA = `data-${VERSION}`;
const KEEP = [SHELL, STATIC, DATA];
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(req) {
  const c = await caches.open(STATIC);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) c.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(event) {
  const c = await caches.open(DATA);
  const hit = await c.match(event.request);
  const fresh = fetch(event.request).then((res) => {
    if (res.ok) c.put(event.request, res.clone());
    return res;
  });
  if (hit) {
    event.waitUntil(fresh.catch(() => undefined));
    return hit;
  }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
  } else if (url.pathname.startsWith('/data/')) {
    event.respondWith(staleWhileRevalidate(event));
  } else if (/^\/(assets|fonts|icons)\//.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
  }
});
