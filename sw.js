// Burn Rate — service worker. Full offline play via a versioned, precached
// app shell. Strategy: cache-first for our own static assets (the game never
// changes at runtime and has no network data), with stale caches purged on
// activate. Bump CACHE_VERSION on any asset change to invalidate old caches.

const CACHE_VERSION = 'burnrate-v5';

// All paths are RELATIVE so the SW works both at the domain root and at a
// GitHub Pages project subpath (e.g. /burnrate/). `self.registration.scope`
// anchors them correctly.
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './src/game.js',
  './src/render.js',
  './src/audio.js',
  './src/logic.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GET; let everything else hit the network untouched.
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Runtime-cache same-origin successful responses so newly added
          // assets become available offline after first visit.
          if (res && res.ok && new URL(req.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Offline and uncached: fall back to the app shell for navigations.
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
    })
  );
});
