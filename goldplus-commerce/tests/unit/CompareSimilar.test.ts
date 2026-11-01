import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pickComparisonPeers } from '../../apps/web/src/lib/product-discovery';

const p = (id: string, name: string, price: number, categoryName = 'Power Devices') =>
  ({ id, name, slug: id, categoryName, retailPriceUgx: price, sku: null, modelNumber: null }) as never;

describe('Compare with similar (gap #11)', () => {
  const bank = p('b1', 'GoldPlus GP-P06 10000mAh Power Bank', 110_000);
  const list = [
    bank,
    p('b2', 'GoldPlus GP-X01 Power Bank', 150_000),
    p('b3', 'GoldPlus GP-P07 20000mAh Power Bank', 115_000),
    p('b4', 'GoldPlus GP-W5 Power Bank', 60_000),
    p('c1', 'GoldPlus GP-C10 USB-C Wall Charger', 112_000),
  ];

  it('offers the two nearest in price from the same subcategory, never itself or another shelf', () => {
    expect(pickComparisonPeers(bank, list).map((x: any) => x.id)).toEqual(['b3', 'b2']);
  });

  it('offers nothing when the product is alone on its shelf', () => {
    expect(pickComparisonPeers(bank, [bank, list[4]])).toEqual([]);
  });

  it('never offers a side-by-side for phone batteries (the battery finder decides)', () => {
    const bat = p('x1', 'GoldPlus Replacement Battery GP-39LT9', 40_000);
    expect(pickComparisonPeers(bat, [bat, p('x2', 'GoldPlus Replacement Battery GP-49FX', 40_000)])).toEqual([]);
  });

  it('the product page links to /compare with this product first', () => {
    const page = readFileSync(new URL('../../apps/web/src/pages/products/[slug].astro', import.meta.url), 'utf8');
    expect(page).toContain("href={`/compare?ids=${[product.id, ...comparePeers.map((p) => p.id)].join(',')}`}");
    expect(page).toContain('data-compare-similar');
  });
});
