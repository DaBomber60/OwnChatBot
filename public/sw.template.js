// Basic service worker: precache key static assets (not dynamic HTML) for faster subsequent loads.
// No custom offline page; if network is unavailable for uncached navigation the browser shows its own error.
// VERSION is injected from package.json by scripts/update-sw-version.js
const VERSION = '__APP_VERSION__';
const STATIC_CACHE = `static-${VERSION}`;
const PRECACHE_URLS = [
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/favicon.ico',
  '/site.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(PRECACHE_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k)))).then(() => clients.claim())
  );
});

// Strategy:
// 1. For navigation (HTML) requests: network-first, fall back to cache (helps when offline after first visit).
// 2. For static assets (images, icons, manifest, CSS/JS): cache-first.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        // Only cache successful (2xx) responses — never cache redirects (302 to /login)
        // or error responses, which would create a logout loop in PWA/offline mode.
        if (res.ok) {
          const copy = res.clone();
          caches.open(STATIC_CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Cache-first for same-origin static assets
    event.respondWith(
      caches.match(req).then(cacheRes => {
        if (cacheRes) return cacheRes;
        return fetch(req).then(networkRes => {
          if (networkRes.ok && (req.destination === 'script' || req.destination === 'style' || req.destination === 'image' || req.destination === 'font')) {
            const copy = networkRes.clone();
            caches.open(STATIC_CACHE).then(c => c.put(req, copy));
          }
          return networkRes;
        });
      })
    );
  }
});
