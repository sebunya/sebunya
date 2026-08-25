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
    expect(SW).toMatch(/await cache\.add\(OFFLINE_ROUTE\)/);
    expect(SW).toMatch(/Promise\.allSettled\(/);
    expect(SW).not.toMatch(/cache\.addAll\(ALLOWED_CACHE_ROUTES\)/);
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
    expect(SW).toMatch(/SENSITIVE_ROUTES\.some\(\(route\) => url\.pathname\.startsWith\(route\)\)[\s\S]{0,40}return;/);
  });
});
