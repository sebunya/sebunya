/* GoldPlus service worker.
 *
 * Goals: fast repeat visits on slow phone networks without ever caching
 * sensitive or personalised pages, and never interfering with form POSTs
 * or cross-origin (API) requests. Progressive enhancement only — browsers
 * without SW support (Opera Mini, older KaiOS, etc.) simply skip it.
 */
const CACHE_NAME = 'goldplus-v3';

// Precached app shell (safe, public, static).
const PRECACHE_ROUTES = [
  '/',
  '/shop',
  '/offline',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
  '/maskable-icon.svg',
  '/js/gp-track.js',
];

// Never cache these — must mirror robots.txt Disallow + anything personalised.
const SENSITIVE_ROUTES = [
  '/admin',
  '/checkout',
  '/cart',
  '/payment',
  '/api',
  '/auth',
  '/account',
  '/dealers/dashboard',
];

// Runtime-cache same-origin static build assets (hashed, immutable).
function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_astro/') ||
    url.pathname.startsWith('/js/') ||
    /\.(css|js|mjs|svg|png|jpg|jpeg|webp|avif|gif|woff2?|ttf|ico)$/i.test(url.pathname)
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Don't let one missing asset abort the whole precache.
      Promise.allSettled(PRECACHE_ROUTES.map((route) => cache.add(route))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only ever touch same-origin GET requests. This leaves API calls,
  // the tracker beacon, and every form POST (login, checkout, account…)
  // completely untouched.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Sensitive / personalised routes: always straight to the network.
  if (SENSITIVE_ROUTES.some((route) => url.pathname.startsWith(route))) return;

  // Navigations: network-first so content is always fresh, with an
  // offline fallback page for genuine connectivity loss.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('/offline').then((r) => r || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })),
      ),
    );
    return;
  }

  // Static build assets: stale-while-revalidate for instant repeat loads.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && res.status === 200) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || network;
        }),
      ),
    );
    return;
  }

  // Anything else: cache-first, then network.
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});
