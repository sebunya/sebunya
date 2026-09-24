import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The service worker shipped with a stray leading comma inside its precache
 * array. That left a hole at one index; cache.addAll() coerced the hole to the
 * string "undefined", requested "/undefined", got a 404, and rejected — so the
 * install failed, the worker never activated, and the offline page was never
 * reachable. Nobody noticed because the registration error only went to
 * console.error. These contracts keep the worker installable.
 */

const SW = readFileSync(join(__dirname, '../../apps/web/public/sw.js'), 'utf8');

/** Pull a `const NAME = [...]` literal out of the source and evaluate it. */
function arrayLiteral(name: string): unknown[] {
  const m = SW.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`));
  if (!m) throw new Error(`${name} not found in sw.js`);
  // OFFLINE_ROUTE is referenced inside the literal; supply it.
  const offline = SW.match(/const OFFLINE_ROUTE = '([^']+)';/)?.[1] ?? '/offline';
  // eslint-disable-next-line no-new-func
  return new Function('OFFLINE_ROUTE', `return ${m[1]};`)(offline) as unknown[];
}

describe('service worker precache list', () => {
  const routes = arrayLiteral('ALLOWED_CACHE_ROUTES');

  it('has no holes — every index is a real string route', () => {
    for (let i = 0; i < routes.length; i++) {
      expect(i in routes, `index ${i} is a hole`).toBe(true);
      expect(typeof routes[i], `index ${i} is ${String(routes[i])}`).toBe('string');
      expect(routes[i] as string).toMatch(/^\//);
    }
  });

  it('includes the offline page, which is the whole point of precaching', () => {
    expect(routes).toContain('/offline');
  });

  it('caches the offline page as a hard requirement, and the rest best-effort', () => {
    // A bare addAll() over the whole list means one missing icon takes the
    // offline page down with it.
    expect(SW).toMatch(/await cache\.add\(anonymous\(OFFLINE_ROUTE\)\)/);
    expect(SW).toMatch(/Promise\.allSettled\(/);
    expect(SW).not.toMatch(/cache\.addAll\(ALLOWED_CACHE_ROUTES\)/);
  });
});

describe('service worker precaches as an anonymous visitor', () => {
  it('fetches every precache entry without cookies, so no one\'s header is kept', () => {
    expect(SW).toMatch(/new Request\(route, \{ credentials: 'omit' \}\)/);
    expect(SW).not.toMatch(/cache\.add\((?!anonymous\()/);
  });

  it('does not precache the per-visitor home and shop pages', () => {
    const routes = arrayLiteral('ALLOWED_CACHE_ROUTES');
    expect(routes).not.toContain('/');
    expect(routes).not.toContain('/shop');
  });

  it('bumped the cache name so the credentialed v4 snapshots are evicted', () => {
    expect(SW).toMatch(/const CACHE_NAME = 'goldplus-v5'/);
  });
});

describe('service worker never caches sensitive routes (CLAUDE.md)', () => {
  const sensitive = arrayLiteral('SENSITIVE_ROUTES') as string[];

  it('excludes checkout, admin, dealer, cart and account', () => {
    for (const must of ['/checkout', '/admin', '/dealers/dashboard', '/cart', '/account']) {
      expect(sensitive).toContain(must);
    }
  });

  it('bails out of the fetch handler for them before any cache lookup', () => {
    // Only a NAVIGATION is answered, straight from the network with the offline
    // page as the fallback; nothing about the response is stored.
    const block = SW.slice(SW.indexOf('SENSITIVE_ROUTES.some('), SW.indexOf('// 2. Navigation requests'));
    expect(block).toMatch(/return;\s*\}\s*$/);
    expect(block).toContain("if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(offlinePage));");
    expect(block).not.toMatch(/cache\.put|caches\.open/);
  });
});

describe('service worker fetch routing', () => {
  /** Runs sw.js against a fake worker scope and reports whether it took over a request. */
  function handles(url: string, init: { method?: string; mode?: string } = {}): boolean {
    const listeners: Record<string, (e: unknown) => void> = {};
    const scope = {
      location: { origin: 'https://shopgoldplus.com' },
      addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
      skipWaiting: () => undefined,
      clients: { claim: () => undefined },
    };
    // eslint-disable-next-line no-new-func
    new Function('self', 'caches', 'fetch', SW)(scope, { match: async () => undefined }, async () => new Response(''));
    let took = false;
    listeners.fetch({ request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'no-cors' }, respondWith: () => { took = true; } });
    return took;
  }

  it('answers same-site GETs and page navigations', () => {
    expect(handles('https://shopgoldplus.com/icon-192.svg')).toBe(true);
    expect(handles('https://shopgoldplus.com/shop', { mode: 'navigate' })).toBe(true);
  });

  it('never touches a POST, a cross-origin request, or a sensitive route', () => {
    expect(handles('https://shopgoldplus.com/api/rec/events', { method: 'POST' })).toBe(false);
    expect(handles('https://metrics.shopgoldplus.com/g/collect?v=2', { method: 'POST' })).toBe(false);
    expect(handles('https://cloudflareinsights.com/cdn-cgi/rum', { method: 'POST' })).toBe(false);
    expect(handles('https://www.googletagmanager.com/gtm.js?id=GTM-X')).toBe(false);
    expect(handles('https://shopgoldplus.com/api/rec/events')).toBe(false);
    expect(handles('https://shopgoldplus.com/account/orders.json')).toBe(false);
  });

  it('gives a sensitive NAVIGATION the offline page when the network is gone, and stores nothing', async () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const scope = {
      location: { origin: 'https://shopgoldplus.com' },
      addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn; },
      skipWaiting: () => undefined,
      clients: { claim: () => undefined },
    };
    const offline = new Response('offline page');
    let opened = false;
    const caches = {
      match: async (key: unknown) => (key === '/offline' ? offline : undefined),
      open: async () => { opened = true; return { put: async () => undefined }; },
    };
    // eslint-disable-next-line no-new-func
    new Function('self', 'caches', 'fetch', SW)(scope, caches, async () => { throw new TypeError('offline'); });
    let answered: Promise<Response> | undefined;
    listeners.fetch({
      request: { url: 'https://shopgoldplus.com/checkout', method: 'GET', mode: 'navigate' },
      respondWith: (p: Promise<Response>) => { answered = p; },
    });
    expect(await answered).toBe(offline);
    expect(opened).toBe(false);
  });

  it('refreshes the regenerated-in-place files from the network first', () => {
    const list = arrayLiteral('NETWORK_FIRST_ROUTES');
    expect(list).toEqual(['/manifest.json', '/locations-index-v1.json']);
  });
});
