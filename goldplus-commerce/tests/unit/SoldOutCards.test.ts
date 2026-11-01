import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Sold-out products read at a glance on every card (owner request 2026-11-01,
 * oraimo's cards as the reference): the photo dims and "Sold out" sits across
 * it; no add/buy buttons. Only out_of_stock gets the overlay: pre-order and
 * unconfirmed keep their pill, so nothing claims scarcity that is not real.
 */
const read = (f: string) => readFileSync(resolve(__dirname, '../..', 'apps/web/src/components', f), 'utf8');
const CARDS = ['ProductCard.astro', 'recommendations/RecommendationCard.astro', 'recommendations/RecentlyViewedRail.astro'];

describe('sold-out overlay on product cards', () => {
  for (const f of CARDS) {
    it(`${f} dims the photo with "Sold out" only for out_of_stock`, () => {
      const src = read(f);
      expect(src).toContain('data-sold-out-overlay');
      expect(src).toMatch(/>Sold out</);
      expect(src).toMatch(/out_of_stock/);
      expect(src).toContain('pointer-events-none');
    });
  }

  it('ProductCard keeps the pill for pre-order and unconfirmed, not for sold out', () => {
    const src = read('ProductCard.astro');
    expect(src).toContain("const soldOut = product.availability.kind === 'out_of_stock';");
    expect(src).toContain('{!inStock && !soldOut && (');
  });
});

import { sortDiscoveryProducts } from '../../apps/web/src/lib/product-discovery';

describe('sold-out products and the shop order', () => {
  it('default order puts sold-out after buyable products in the same subcategory', () => {
    const p = (name: string, kind: string) => ({ id: name, slug: name, name, categoryName: 'Chargers', availability: { kind }, attributeValues: [] }) as any;
    const out = sortDiscoveryProducts([p('A charger', 'out_of_stock'), p('B charger', 'in_stock'), p('C charger', 'pre_order')], 'default');
    expect(out.map((x) => x.name)).toEqual(['B charger', 'C charger', 'A charger']);
  });

  it('a price sort stays a strict price sort', () => {
    const p = (name: string, kind: string, price: number) => ({ id: name, slug: name, name, categoryName: 'Chargers', retailPriceUgx: price, availability: { kind }, attributeValues: [] }) as any;
    const out = sortDiscoveryProducts([p('B', 'in_stock', 9000), p('A', 'out_of_stock', 5000)], 'price-low-high');
    expect(out.map((x) => x.name)).toEqual(['A', 'B']);
  });

  it('no "Limited time" urgency line on a sold-out card', () => {
    expect(read('ProductCard.astro')).toContain('discount.endsIso && !soldOut');
  });
});
