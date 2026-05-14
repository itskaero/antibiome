// ═══════════════════════════════════════════════════════════
//  service-worker.js — Antibiome PWA
//  Strategy: Cache-first for static assets, network-first for
//  Firestore / CDN resources, offline fallback to index.html.
// ═══════════════════════════════════════════════════════════

const CACHE_NAME  = 'antibiome-v2';
const STATIC_URLS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './firebase-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ── Install: pre-cache all static assets ────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ──────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for external, cache-first for local ─
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always pass through non-GET and Chrome-extension requests
  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // External CDN / Firebase — network first, no offline cache
  const isExternal = url.origin !== self.location.origin;
  if (isExternal) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Local files — cache first, fall back to network, then offline page
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
      return cached || networkFetch.catch(() => caches.match('./index.html'));
    })
  );
});
