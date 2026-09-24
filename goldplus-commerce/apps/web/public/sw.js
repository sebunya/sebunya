// v5: evicts the v4 snapshots, which were fetched WITH the visitor's cookies
// (signed-in header, first name, points, mini-cart) and served offline to
// whoever used the device next.
const CACHE_NAME = 'goldplus-v5';

// Precached, but refreshed from the network whenever it answers: these are
// regenerated in place (the locations index was, in 884ac706), so cache-first
// would have served the first copy forever.
const NETWORK_FIRST_ROUTES = ['/manifest.json', '/locations-index-v1.json'];

const offlinePage = () => caches.match(OFFLINE_ROUTE).then((r) => r || new Response('Offline', { status: 503 }));

// The page a customer sees when the network drops. It MUST be cached at install,
// or the fallback below serves a bare "Offline" response instead.
const OFFLINE_ROUTE = '/offline';

// Best-effort precache. Kept as one entry per line: a stray leading comma on the
// last entry once punched a hole in this array, cache.addAll() then requested
// "/undefined", got a 404, and the install rejected — so the worker never
// activated and offline support silently did not exist in production.
// '/' and '/shop' are not here: they are rendered per visitor, and they were
// never used as a fallback, only served stale to non-navigation requests.
const ALLOWED_CACHE_ROUTES = [
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
  '/orders',
  '/track-order',
];

// Precache as an anonymous visitor. Adding a bare URL string sends the session
// cookie, and the offline page's header is rendered per visitor.
const anonymous = (route) => new Request(route, { credentials: 'omit' });

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // addAll() is all-or-nothing: one missing icon would take the offline page
      // down with it. Cache the offline page as a hard requirement and the rest
      // individually, so a single bad asset degrades one entry, not the worker.
      await cache.add(anonymous(OFFLINE_ROUTE));
      await Promise.allSettled(
        ALLOWED_CACHE_ROUTES.filter((route) => route !== OFFLINE_ROUTE).map((route) => cache.add(anonymous(route))),
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

  // 0. Only same-site GETs are ours to answer. Everything else (analytics beacons
  //    to metrics.shopgoldplus.com / Cloudflare / Clarity, any POST) goes straight to
  //    the network: proxying it through this worker added a hop to every beacon,
  //    could lose one sent as the page unloads, and turned a blocked third-party
  //    request into a worker error in the console (seen in Firefox, 2026-09-23).
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // 1. Sensitive routes: always the network, never cached. A NAVIGATION to one
  //    still gets the offline page when the network is gone: losing signal on
  //    checkout used to show the browser's error page instead of the page that
  //    says the basket is saved. The response itself is never stored.
  if (SENSITIVE_ROUTES.some((route) => url.pathname.startsWith(route))) {
    if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(offlinePage));
    return;
  }

  // 2. Navigation requests: network first, fall back to /offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(offlinePage));
    return;
  }

  // 2b. Regenerated-in-place files: network first, refreshing the cached copy.
  if (NETWORK_FIRST_ROUTES.includes(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(anonymous(url.pathname), copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(anonymous(url.pathname)).then((r) => r || Response.error())),
    );
    return;
  }

  // 3. Everything else: cache first, fall through to network.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});
