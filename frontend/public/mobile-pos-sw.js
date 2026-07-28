const CACHE_NAME = 'itemba-mobile-pos-lite-v1';
const POS_ROUTES = new Set(['/mobile-pos', '/mobile-pos/activate']);

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never cache API responses: product availability, accounts, and final sale
  // posting must always be verified by the server when a connection returns.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  const isPosDocument = request.mode === 'navigate' && POS_ROUTES.has(url.pathname);
  const isStaticAsset = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/brand/');
  if (!isPosDocument && !isStaticAsset) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        return cached || Response.error();
      }),
  );
});
