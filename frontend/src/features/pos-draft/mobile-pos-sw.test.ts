import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const origin = 'https://pos.example';
const currentName = 'itemba-mobile-pos-draft-v3';
const previousName = 'itemba-mobile-pos-draft-v2';
const invitePath = `/mobile-pos/join/${'a'.repeat(32)}`;
const claimPath = `/mobile-pos/join/${'b'.repeat(32)}`;
const source = readFileSync(resolve(process.cwd(), 'public/mobile-pos-sw.js'), 'utf8');
type CacheKey = string | { url: string; method?: string };
const keyUrl = (key: CacheKey) => new URL(typeof key === 'string' ? key : key.url, origin).href;

class PublicCache {
  private readonly entries = new Map<string, Response>();
  failWrites = false;
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url, method: 'GET' }));
  }
  async match(key: CacheKey) {
    return this.entries.get(keyUrl(key))?.clone();
  }
  async put(key: CacheKey, response: Response) {
    if (this.failWrites) throw new Error('Storage quota exceeded');
    // Cache.put consumes its input; matching returns a separate response body.
    this.entries.set(
      keyUrl(key),
      new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: response.headers,
      }),
    );
  }
}

function worker(setup?: string) {
  const stores = new Map<string, PublicCache>();
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new PublicCache());
      return stores.get(name)!;
    },
  };
  const html = (path: string) =>
    `<html>fresh:${path}<script src="/_next/static/chunks/new.js"></script><link rel="stylesheet" href="/_next/static/css/new.css"></html>`;
  const network = vi.fn(async (key: CacheKey) => {
    const path = new URL(keyUrl(key)).pathname;
    return new Response(path.startsWith('/_next/') ? `fresh asset:${path}` : html(path));
  });
  type Event = {
    request?: { url: string; method: string; mode: string };
    waitUntil: (promise: Promise<unknown>) => void;
    respondWith: (promise: Promise<Response>) => void;
  };
  const listeners = new Map<string, (event: Event) => void>();
  const claim = vi.fn(async () => undefined);
  runInNewContext(source, {
    URL,
    Response,
    caches,
    fetch: network,
    self: {
      location: new URL(`/mobile-pos-sw.js${setup ? `?setup=${setup}` : ''}`, origin),
      addEventListener: (name: string, listener: (event: Event) => void) =>
        listeners.set(name, listener),
      skipWaiting: vi.fn(),
      clients: { claim },
    },
  });
  const dispatch = (name: string, path?: string, mode = 'navigate') => {
    const work: Promise<unknown>[] = [];
    let active = true;
    let response: Promise<Response> | undefined;
    listeners.get(name)!({
      ...(path ? { request: { url: keyUrl(path), method: 'GET', mode } } : {}),
      waitUntil: (promise) => {
        if (!active) throw new Error('waitUntil registered after the event ended');
        work.push(promise);
      },
      respondWith: (promise) => {
        response = promise;
      },
    });
    active = false;
    return { response, lifetime: Promise.all(work) };
  };
  return { caches, network, dispatch, html, claim };
}

describe('installed POS service-worker update', () => {
  it('retains exact invite and pending-claim start URLs and new build assets after deleting v2', async () => {
    const app = worker(); // POS can register without the original setup query.
    const previous = await app.caches.open(previousName);
    for (const path of ['/mobile-pos', invitePath, claimPath])
      await previous.put(path, new Response(`old:${path}`));
    await previous.put('/_next/static/chunks/old.js', new Response('old asset'));
    await previous.put('/api/mobile-pos/pos-drafts', new Response('private data'));
    await previous.put('/sales-orders', new Response('office document'));
    await app.caches.open('unrelated-cache');

    await app.dispatch('install').lifetime;
    await app.dispatch('activate').lifetime;
    expect(await app.caches.keys()).toEqual(['unrelated-cache', currentName]);
    expect(app.claim).toHaveBeenCalledOnce();
    const current = await app.caches.open(currentName);
    expect(await current.match('/api/mobile-pos/pos-drafts')).toBeUndefined();
    expect(await current.match('/sales-orders')).toBeUndefined();

    app.network.mockRejectedValue(new Error('Offline'));
    for (const path of [invitePath, claimPath]) {
      const event = app.dispatch('fetch', `${path}?from=installed-icon`);
      expect(await (await event.response!).text()).toBe(app.html(path));
      await event.lifetime;
    }
    for (const path of ['/_next/static/chunks/new.js', '/_next/static/css/new.css']) {
      const event = app.dispatch('fetch', path, 'cors');
      expect(await (await event.response!).text()).toBe(`fresh asset:${path}`);
      await event.lifetime;
    }
  });

  it('precaches the original invitation and dependencies on a fresh installation', async () => {
    const app = worker('a'.repeat(32));
    await app.dispatch('install').lifetime;
    await app.dispatch('activate').lifetime;
    app.network.mockRejectedValue(new Error('Offline'));
    const event = app.dispatch('fetch', invitePath);
    expect(await (await event.response!).text()).toBe(app.html(invitePath));
    await event.lifetime;
  });

  it('preserves the working exact shell and its assets when a new build dependency fails', async () => {
    const app = worker();
    const previous = await app.caches.open(previousName);
    const oldHtml = `<html>old invite<script src="/_next/static/chunks/old.js"></script></html>`;
    await previous.put(invitePath, new Response(oldHtml));
    await previous.put('/_next/static/chunks/old.js', new Response('old asset'));
    app.network.mockImplementation(async (key) =>
      keyUrl(key).includes('/_next/')
        ? new Response('Unavailable', { status: 503 })
        : new Response(app.html(new URL(keyUrl(key)).pathname)),
    );
    await app.dispatch('install').lifetime;
    await app.dispatch('activate').lifetime;
    expect(await app.caches.keys()).not.toContain(previousName);
    app.network.mockRejectedValue(new Error('Offline'));
    const document = app.dispatch('fetch', invitePath);
    expect(await (await document.response!).text()).toBe(oldHtml);
    await document.lifetime;
    const asset = app.dispatch('fetch', '/_next/static/chunks/old.js', 'cors');
    expect(await (await asset.response!).text()).toBe('old asset');
    await asset.lifetime;
  });

  it('keeps the earlier public cache accessible when quota prevents its migration', async () => {
    const app = worker();
    const previous = await app.caches.open(previousName);
    await previous.put(invitePath, new Response('original invitation'));
    (await app.caches.open(currentName)).failWrites = true;
    await app.dispatch('install').lifetime;
    await app.dispatch('activate').lifetime;
    expect(await app.caches.keys()).toContain(previousName);
    app.network.mockRejectedValue(new Error('Offline'));
    const event = app.dispatch('fetch', invitePath);
    expect(await (await event.response!).text()).toBe('original invitation');
    await event.lifetime;
  });

  it('registers cache lifetime synchronously and returns online data despite a failed cache write', async () => {
    const app = worker();
    (await app.caches.open(currentName)).failWrites = true;
    const event = app.dispatch('fetch', '/mobile-pos');
    expect(await (await event.response!).text()).toBe(app.html('/mobile-pos'));
    await expect(event.lifetime).resolves.toBeDefined();
    const api = app.dispatch('fetch', '/api/mobile-pos/pos-drafts', 'cors');
    expect(api.response).toBeUndefined();
    await api.lifetime;
    expect(app.network).toHaveBeenCalledOnce();
  });
});
