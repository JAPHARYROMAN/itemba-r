const CACHE_NAME = 'itemba-mobile-pos-draft-v3';
const setup = new URL(self.location.href).searchParams.get('setup');
const setupPath =
  setup && /^[A-Za-z0-9_-]{20,128}$/.test(setup) ? `/mobile-pos/join/${setup}` : null;
const isPosRoute = (path) =>
  path === '/mobile-pos' || /^\/mobile-pos\/join\/[A-Za-z0-9_-]{20,128}$/.test(path);
const isPosCache = (name) =>
  name.startsWith('itemba-mobile-pos-lite-') || name.startsWith('itemba-mobile-pos-draft-');
const isStaticAsset = (path) => path.startsWith('/_next/static/') || path.startsWith('/brand/');

async function cacheShell(cache, path) {
  const response = await fetch(path, { cache: 'reload' });
  if (!response.ok) return;
  // A background update can receive a new build's HTML before its scripts have
  // ever loaded. Save its public dependencies before replacing a working shell.
  const html = await response.clone().text();
  const assets = new Set();
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)=["']([^"']+)["']/gi)) {
    const url = new URL(match[1], self.location.origin);
    if (url.origin === self.location.origin && isStaticAsset(url.pathname)) assets.add(url.href);
  }
  for (const asset of assets) {
    if (await cache.match(asset)) continue;
    const dependency = await fetch(asset, { cache: 'reload' });
    if (!dependency.ok) throw new Error('POS shell dependency is unavailable');
    await cache.put(asset, dependency);
  }
  await cache.put(path, response);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const paths = new Set(['/mobile-pos', ...(setupPath ? [setupPath] : [])]);
      // The installed manifest may still start at the original invitation even
      // when POS registers this worker without a setup query. Keep those exact
      // document URLs, including a pending claim, through a background update.
      for (const name of await caches.keys()) {
        if (!isPosCache(name) || name === CACHE_NAME) continue;
        const previous = await caches.open(name);
        for (const request of await previous.keys()) {
          const url = new URL(request.url);
          if (url.origin === self.location.origin && isPosRoute(url.pathname))
            paths.add(url.pathname);
        }
      }
      // Public shells only. Failure to precache cannot make online setup unusable.
      for (const path of paths) {
        try {
          await cacheShell(cache, path);
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
      const cache = await caches.open(CACHE_NAME);
      for (const name of await caches.keys()) {
        if (!isPosCache(name) || name === CACHE_NAME) continue;
        const previous = await caches.open(name);
        try {
          for (const request of await previous.keys()) {
            const url = new URL(request.url);
            if (
              request.method !== 'GET' ||
              url.origin !== self.location.origin ||
              (!isPosRoute(url.pathname) && !isStaticAsset(url.pathname)) ||
              (await cache.match(request))
            )
              continue;
            const response = await previous.match(request);
            if (response) await cache.put(request, response);
          }
          await caches.delete(name);
        } catch {
          // Retain the earlier public cache if quota/storage prevents migration.
          // IndexedDB captures and session partitions are never changed here.
          continue;
        }
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
  if (!isPosDocument && !isStaticAsset(url.pathname)) return;

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
      let cached =
        (await cache.match(request)) || (isPosDocument ? await cache.match(url.pathname) : null);
      if (!cached) {
        for (const name of await caches.keys()) {
          if (!isPosCache(name) || name === CACHE_NAME) continue;
          const previous = await caches.open(name);
          cached =
            (await previous.match(request)) ||
            (isPosDocument ? await previous.match(url.pathname) : null);
          if (cached) break;
        }
      }
      return cached || Response.error();
    }),
  );
});
