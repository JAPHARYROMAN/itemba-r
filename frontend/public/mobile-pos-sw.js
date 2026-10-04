const CACHE_NAME = 'itemba-mobile-pos-draft-v3';
const setup = new URL(self.location.href).searchParams.get('setup');
const setupPath =
  setup && /^[A-Za-z0-9_-]{20,128}$/.test(setup) ? `/mobile-pos/join/${setup}` : null;
const isPosRoute = (path) =>
  path === '/mobile-pos' || /^\/mobile-pos\/join\/[A-Za-z0-9_-]{20,128}$/.test(path);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Public shells only. Failure to precache cannot make online setup unusable.
      for (const path of ['/mobile-pos', ...(setupPath ? [setupPath] : [])]) {
        try {
          const response = await fetch(path, { cache: 'reload' });
          if (response.ok) await cache.put(path, response);
        } catch {
          // Precache is optional; online navigation retries and saved captures remain in IndexedDB.
          continue;
        }
      }
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (
          (name.startsWith('itemba-mobile-pos-lite-') ||
            name.startsWith('itemba-mobile-pos-draft-')) &&
          name !== CACHE_NAME
        )
          await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never cache API responses: product availability, accounts, and final sale
  // posting must always be verified by the server when a connection returns.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  const isPosDocument = request.mode === 'navigate' && isPosRoute(url.pathname);
  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/brand/');
  if (!isPosDocument && !isStaticAsset) return;

  const network = fetch(request);
  // Register the cache work while the event is active. The worker must stay
  // alive until this asset is saved for a later offline restart; quota/storage
  // failures must never turn a healthy online response into a failed request.
  event.waitUntil(
    network
      .then(async (response) => {
        if (!response.ok) return;
        const copy = response.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, copy);
      })
      .catch(() => undefined),
  );
  event.respondWith(
    network.catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached =
        (await cache.match(request)) || (isPosDocument ? await cache.match(url.pathname) : null);
      return cached || Response.error();
    }),
  );
});
