const CACHE_NAME = 'goldplus-v2';

const ALLOWED_CACHE_ROUTES = [
  '/',
  '/shop',
  '/offline',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
  '/maskable-icon.svg',
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
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ALLOWED_CACHE_ROUTES)),
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
