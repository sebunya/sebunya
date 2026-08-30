import { describe, expect, it } from 'vitest';
import { GET } from '../../apps/web/src/pages/search';

/**
 * /search is a forward onto the storefront's real search page, /shop.
 *
 * shop.astro already owns the filtering, the taxonomy, the product cards, the
 * no-results state, noindex,follow and the server-side search analytics. These
 * assert the forward keeps the customer's query intact — a shared or typed
 * /search link used to 404 outright.
 */
const call = (href: string) => GET({ url: new URL(href) } as never) as Response;

describe('/search forwards to the one search page', () => {
  it('carries the term, normalised to the name shop.astro reads', () => {
    const res = call('https://shopgoldplus.com/search?q=charger');
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('/shop?search=charger');
  });

  it('decodes a multi-word query', () => {
    expect(call('https://shopgoldplus.com/search?q=power%20bank').headers.get('Location'))
      .toBe('/shop?search=power+bank');
  });

  it('keeps other filters alongside the term', () => {
    const to = call('https://shopgoldplus.com/search?q=charger&category=power').headers.get('Location')!;
    expect(to).toContain('search=charger');
    expect(to).toContain('category=power');
  });

  it('accepts the search= spelling too, and never forwards both names', () => {
    const to = call('https://shopgoldplus.com/search?search=charger&q=earbuds').headers.get('Location')!;
    // Two names could otherwise arrive as two different terms.
    expect(to).toBe('/shop?search=charger');
  });

  it('an empty query resolves to the shop rather than 404ing', () => {
    expect(call('https://shopgoldplus.com/search').headers.get('Location')).toBe('/shop');
    expect(call('https://shopgoldplus.com/search?q=').headers.get('Location')).toBe('/shop');
    expect(call('https://shopgoldplus.com/search?q=%20%20').headers.get('Location')).toBe('/shop');
  });

  it('applies the shop own normalisation, so the two cannot disagree', () => {
    // Angle brackets and control characters are stripped, whitespace collapsed.
    const to = call('https://shopgoldplus.com/search?q=%3Cscript%3E%20%20charger').headers.get('Location')!;
    expect(to).not.toContain('<');
    expect(to).not.toContain('%3C');
    expect(to).toContain('charger');
  });

  it('bounds a very long query rather than passing it through', () => {
    const to = call(`https://shopgoldplus.com/search?q=${'a'.repeat(500)}`).headers.get('Location')!;
    expect(to.length).toBeLessThan(200);
  });
});
