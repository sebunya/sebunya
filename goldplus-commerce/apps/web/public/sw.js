const CACHE_NAME = 'goldplus-v4';

// The page a customer sees when the network drops. It MUST be cached at install,
// or the fallback below serves a bare "Offline" response instead.
const OFFLINE_ROUTE = '/offline';

// Best-effort precache. Kept as one entry per line: a stray leading comma on the
// last entry once punched a hole in this array, cache.addAll() then requested
// "/undefined", got a 404, and the install rejected — so the worker never
// activated and offline support silently did not exist in production.
const ALLOWED_CACHE_ROUTES = [
  '/',
  '/shop',
  OFFLINE_ROUTE,
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
  '/maskable-icon.svg',
  '/locations-index-v1.json',
];

// Strictly NO CACHE list — must mirror robots.txt Disallow list.
const SENSITIVE_ROUTES = [
  '/admin',
  '/checkout',
  '/cart',
  '/payment',
  '/api',
  '/dealers/dashboard',
  '/account',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // addAll() is all-or-nothing: one missing icon would take the offline page
      // down with it. Cache the offline page as a hard requirement and the rest
      // individually, so a single bad asset degrades one entry, not the worker.
      await cache.add(OFFLINE_ROUTE);
      await Promise.allSettled(
        ALLOWED_CACHE_ROUTES.filter((route) => route !== OFFLINE_ROUTE).map((route) => cache.add(route)),
      );
    }),
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
  const url = new URL(event.request.url);

  // 1. Sensitive routes: always go to the network, never cache.
  if (SENSITIVE_ROUTES.some((route) => url.pathname.startsWith(route))) {
    return; // Let the browser handle it without our intervention.
  }

  // 2. Navigation requests: network first, fall back to /offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/offline').then((r) => r || new Response('Offline', { status: 503 }))),
    );
    return;
  }

  // 3. Everything else: cache first, fall through to network.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
