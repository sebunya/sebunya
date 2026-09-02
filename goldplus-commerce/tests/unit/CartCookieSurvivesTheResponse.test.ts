import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

/**
 * A cookie set from a component is set after the response has begun, so Astro
 * drops it: "Astro.cookies.set() was called after the cookies had already been
 * sent to the browser". The header component minted the cart credential, which
 * meant a shopper without one was handed a brand-new basket on every page —
 * 343 warnings per container in six hours on 2026-09-02.
 */
describe('the cart credential survives the response', () => {
  it('is minted in middleware, where a cookie can still be set', () => {
    const mw = read('apps/web/src/middleware.ts');
    expect(mw).toContain('resolveCartCredential(context.cookies, userId)');
    expect(mw).toContain('context.locals.gpCart');
    // Documents only: an asset request has no basket to mint.
    const block = mw.slice(mw.indexOf('const userId = await resolveAuthenticatedUserId'));
    expect(mw.slice(0, mw.indexOf('const userId = await resolveAuthenticatedUserId'))).toContain('if (isDocument) {');
    expect(block).toContain('} catch {');
  });

  it('the header consumes what middleware resolved instead of minting its own', () => {
    const nav = read('apps/web/src/components/GpNav.astro');
    expect(nav).toContain('Astro.locals.gpCart !== undefined');
    expect(nav).toContain('Astro.locals.gpUserId !== undefined');
    // The fallback stays for render paths without middleware, but the happy
    // path must not call the minting function.
    expect(nav.indexOf('Astro.locals.gpCart')).toBeLessThan(nav.indexOf('resolveCartCredential(Astro.cookies'));
  });

  it('pages keep their own resolution, which is legitimate in frontmatter', () => {
    // cart.astro resolves in page frontmatter — that runs before the response.
    expect(read('apps/web/src/pages/cart.astro')).toContain('resolveCartCredential(Astro.cookies');
  });
});
