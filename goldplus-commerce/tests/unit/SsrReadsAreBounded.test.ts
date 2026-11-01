import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SSR_READ_TIMEOUT_MS, withDefaultReadTimeout } from '../../apps/web/src/lib/api';

/**
 * 223 of 338 SSR calls to the API passed no signal, so a stalled API held
 * storefront renders open for undici's 300s default and pinned the web replicas.
 */
describe('SSR reads of the internal API carry a default timeout', () => {
  it('adds one to a GET or HEAD that has none', () => {
    expect(withDefaultReadTimeout('http://api:3000/x')?.signal).toBeInstanceOf(AbortSignal);
    expect(withDefaultReadTimeout('http://api:3000/x', { method: 'head' })?.signal).toBeInstanceOf(AbortSignal);
    expect(SSR_READ_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('keeps a caller\'s own signal', () => {
    const own = new AbortController().signal;
    expect(withDefaultReadTimeout('http://api:3000/x', { signal: own })?.signal).toBe(own);
  });

  it('never bounds a write: an aborted checkout POST can leave an outcome the customer cannot see', () => {
    const init = { method: 'POST', body: '{}' };
    expect(withDefaultReadTimeout('http://api:3000/orders/create', init)).toBe(init);
  });

  it('the payment return page and the admin badge have their own short bounds', () => {
    const root = join(__dirname, '../..');
    expect(readFileSync(join(root, 'apps/web/src/pages/checkout/pesapal/callback.astro'), 'utf8')).toContain('signal: AbortSignal.timeout(4000)');
    expect(readFileSync(join(root, 'apps/web/src/layouts/AdminLayout.astro'), 'utf8')).toContain('signal: AbortSignal.timeout(2000)');
  });
});

describe('the admin console is navigable on a phone', () => {
  const layout = readFileSync(join(__dirname, '../../apps/web/src/layouts/AdminLayout.astro'), 'utf8');

  it('renders a no-script disclosure below lg that lists the same sections as the sidebar', () => {
    const menu = layout.slice(layout.indexOf('<details class="lg:hidden'), layout.indexOf('</details>'));
    expect(menu).toContain('ADMIN_NAVIGATION.map(');
    expect(menu).toContain('group.items.map(');
    expect(menu).not.toMatch(/\son[a-z]+=/);
  });

  it('truncates a long page title instead of clipping it', () => {
    expect(layout).toMatch(/<h1 class="[^"]*truncate min-w-0/);
  });
});
