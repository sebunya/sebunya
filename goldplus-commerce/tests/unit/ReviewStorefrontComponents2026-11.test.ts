import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { isOrderInTransit } from '../../apps/web/src/lib/orderInTransit';
import { uuidV4 } from '../../apps/web/src/lib/uuid';
import { recommendedItemSubcategory } from '../../apps/web/src/lib/recommendation-display';

const web = (p: string) => readFileSync(join(__dirname, '../../apps/web/src', p), 'utf8');
const nav = web('components/GpNav.astro');

/** Pull the header's own esc()/safeUrl() out of the inline script and run them. */
function navHelpers(): { esc: (s: unknown) => string; safeUrl: (s: unknown) => string } {
  const start = nav.indexOf('    function esc(s');
  const end = nav.indexOf('    function mark(t');
  expect(start).toBeGreaterThan(0);
  // The script is TypeScript: strip its types the way the bundler does, then run it.
  const src = ts.transpileModule(nav.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  // eslint-disable-next-line no-new-func
  return new Function(`${src}; return { esc: esc, safeUrl: safeUrl };`)();
}

describe('header search suggestions (XSS)', () => {
  const { esc, safeUrl } = navHelpers();
  it('esc() escapes single quotes as well as & < > "', () => {
    expect(esc(`a'b"c<d>&`)).toBe('a&#39;b&quot;c&lt;d&gt;&amp;');
  });
  it('safeUrl() keeps site paths and http(s) URLs, escaped', () => {
    expect(safeUrl('/products/x?a=1&b=2')).toBe('/products/x?a=1&amp;b=2');
    expect(safeUrl('https://cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg');
  });
  it('safeUrl() drops javascript:, data:, protocol-relative and quote-breaking values', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl(' JaVaScRiPt:alert(1)')).toBe('');
    expect(safeUrl('data:text/html,x')).toBe('');
    expect(safeUrl('//evil.example/x')).toBe('');
    expect(safeUrl('/\\evil.example')).toBe('');
    expect(safeUrl('/p" onmouseover="alert(1)')).not.toContain('"');
  });
  it('the suggestion markup sends p.u and p.i through safeUrl, never raw', () => {
    expect(nav).not.toContain(`'<a href="' + p.u`);
    expect(nav).not.toContain(`src="' + p.i`);
    expect(nav).toContain('safeUrl(p.u)');
    expect(nav).toContain('safeUrl(p.i)');
  });
});

describe('orderInTransit', () => {
  it('a delivered, failed or not-yet-dispatched order is not in transit', () => {
    for (const s of ['delivered', 'DELIVERED', 'DELIVERY_FAILED', 'READY_FOR_DISPATCH', 'cancelled', '', null]) {
      expect(isOrderInTransit(s)).toBe(false);
    }
  });
  it('an order out for delivery, dispatched or shipped is', () => {
    for (const s of ['OUT_FOR_DELIVERY', 'out_for_delivery', 'DISPATCHED', 'in_transit', 'SHIPPED']) {
      expect(isOrderInTransit(s)).toBe(true);
    }
  });
  it('the header uses the helper, not the old /deliver/ regex', () => {
    expect(nav).toContain('isOrderInTransit(o?.status)');
    expect(nav).not.toMatch(/\/deliver\|transit/);
  });
});

describe('saleLive with no end date', () => {
  it('a running promotion without endsIso is live, and its clock is not rendered', () => {
    expect(nav).toMatch(/const saleLive = navDeal\.active\s*\n\s*\? \(saleEnds \? Date\.now\(\) < new Date\(saleEnds\)\.getTime\(\) : true\)/);
    expect(nav).toContain(`data-sale-live={saleLive ? '1' : '0'}`);
    expect(nav).toContain(`nav.getAttribute('data-sale-live') === '1'`);
    expect(nav).toContain(': <h3>On now</h3>}');
  });
});

describe('uuidV4 fallback', () => {
  const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  it('returns a v4 uuid when crypto.randomUUID is missing', () => {
    const real = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: { getRandomValues: real.getRandomValues.bind(real) }, configurable: true });
    try {
      expect(uuidV4()).toMatch(uuidShape);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true });
    }
  });
  it('returns a v4 uuid with no crypto at all', () => {
    const real = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      expect(uuidV4()).toMatch(uuidShape);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true });
    }
  });
  it('the recently-viewed rail no longer calls crypto.randomUUID directly', () => {
    const rail = web('components/recommendations/RecentlyViewedRail.astro');
    expect(rail).not.toContain('crypto.randomUUID');
    expect(rail).toContain('uuidV4()');
  });
});

describe('related rail subcategory', () => {
  it('uses the item\'s own name/category, not the current product\'s category', () => {
    // A power bank recommended on a wall-charger page stays a power bank.
    const a = recommendedItemSubcategory({ name: 'Oraimo 20000mAh Power Bank' });
    const b = recommendedItemSubcategory({ name: 'Oraimo 20000mAh Power Bank', categoryName: 'Power' });
    expect(a).toBe(b);
    const rail = web('components/recommendations/RelatedProductsRail.astro');
    expect(rail).not.toMatch(/name: item\.name, categoryName \}/);
    expect(rail).toContain('recommendedItemSubcategory(');
  });
});

describe('product card add-to-cart form', () => {
  const card = web('components/ProductCard.astro');
  it('posts the list price: cart lines are list-priced and the sale comes off the basket once', () => {
    expect(card).toContain('name="priceUgx" value={product.retailPriceUgx ?? 0}');
    const cart = web('pages/cart.astro');
    expect(cart).toContain('basketSavingUgx(');
  });
  it('carries the search query and rank so search add_to_cart is recorded', () => {
    expect(card).toContain('<input type="hidden" name="searchQuery" value={searchQuery} />');
    expect(card).toContain('<input type="hidden" name="searchRank" value={searchRank} />');
  });
});

describe('Notice default for a disabled integration', () => {
  it('says "Not configured" (CLAUDE.md rule)', () => {
    const notice = web('components/Notice.astro');
    expect(notice).toContain(`title: title ?? 'Not configured'`);
    expect(notice).not.toContain(`title ?? 'Temporarily unavailable'`);
  });
});
