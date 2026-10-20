import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyShopFacets, buildShopFacets, parseShopFacets, toggleShopFacet, writeShopFacets, EMPTY_FACETS,
} from '../../apps/web/src/lib/product-discovery';

const spec = (name: string, value: string, unit: string | null = null, isVerified = true) => ({ name, value, unit, isVerified });
const p = (id: string, price: number, attrs: ReturnType<typeof spec>[]) =>
  ({ id, slug: id, name: `GoldPlus ${id}`, categoryName: 'Power Devices', retailPriceUgx: price, attributeValues: attrs }) as never;

const banks = [
  p('a', 110_000, [spec('Capacity', '20000', 'mAh'), spec('Colour', 'Black')]),
  p('b', 120_000, [spec('Capacity', '20000', 'mAh'), spec('Colour', 'White')]),
  p('c', 90_000, [spec('Capacity', '10000', 'mAh'), spec('Colour', 'Black')]),
  p('d', 15_000, [spec('Capacity', '5000', 'mAh', false)]), // unverified: never a filter value
];

describe('shop filters (gap #5)', () => {
  it('builds price and verified-spec filters with counts', () => {
    const f = buildShopFacets(banks, EMPTY_FACETS);
    expect(f.map((x) => x.key)).toEqual(['price', 'Capacity', 'Colour']);
    expect(f[1].options.map((o) => `${o.value}:${o.count}`)).toEqual(['10000 mAh:1', '20000 mAh:2']);
  });

  it('two values of one filter show either; different filters must all hold', () => {
    const either = { price: [], specs: { Capacity: ['20000 mAh', '10000 mAh'] } };
    expect(applyShopFacets(banks, either).map((x: any) => x.id)).toEqual(['a', 'b', 'c']);
    const both = { price: [], specs: { Capacity: ['20000 mAh'], Colour: ['Black'] } };
    expect(applyShopFacets(banks, both).map((x: any) => x.id)).toEqual(['a']);
  });

  it('a count says what choosing it would show, given the other choices', () => {
    const f = buildShopFacets(banks, { price: [], specs: { Colour: ['Black'] } });
    const cap = f.find((x) => x.key === 'Capacity')!;
    expect(cap.options.map((o) => `${o.value}:${o.count}`)).toEqual(['10000 mAh:1', '20000 mAh:1']);
  });

  it('a filter that does not split the shelf is not shown', () => {
    const same = [p('x', 10_000, [spec('Colour', 'Black')]), p('y', 12_000, [spec('Colour', 'Black')])];
    expect(buildShopFacets(same, EMPTY_FACETS)).toEqual([]);
  });

  it('round-trips through the URL and drops junk', () => {
    const params = new URLSearchParams('price=over-100k&price=nope&spec=Capacity:20000%20mAh&spec=Protection:x&spec=bad');
    const sel = parseShopFacets(params);
    expect(sel).toEqual({ price: ['over-100k'], specs: { Capacity: ['20000 mAh'] } });
    const out = new URLSearchParams();
    writeShopFacets(out, toggleShopFacet(sel, 'Capacity', '20000 mAh'));
    expect(out.toString()).toBe('price=over-100k');
  });

  it('a filtered view is noindex with the shelf as canonical, and filters reset on a new shelf', () => {
    const page = readFileSync(new URL('../../apps/web/src/pages/shop.astro', import.meta.url), 'utf8');
    expect(page).toContain("const robotsMeta = hasShopFacets(facetSelection) ? 'noindex,follow' : shelfRobotsMeta;");
    expect(page).toContain("const shelfChanged = 'search' in overrides || 'category' in overrides || 'subcategory' in overrides;");
  });
});
