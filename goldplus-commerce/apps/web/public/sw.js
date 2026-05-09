const CACHE_NAME = 'goldplus-v1';
const ALLOWED_CACHE_ROUTES = [
  '/',
  '/shop',
  '/manifest.json',
  '/favicon.ico',
];

// Strictly NO CACHE list
const SENSITIVE_ROUTES = [
  '/admin',
  '/checkout',
  '/payment',
  '/api',
  '/dealer'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ALLOWED_CACHE_ROUTES);
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Bypass cache for sensitive routes immediately
  if (SENSITIVE_ROUTES.some(route => url.pathname.startsWith(route))) {
    return fetch(event.request);
  }

  // 2. Cache-first strategy for allowed assets
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    }).catch(() => {
      // Offline fallback
      if (event.request.destination === 'document') {
        return caches.match('/');
      }
    })
  );
});
