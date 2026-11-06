import { describe, expect, it } from 'vitest';
import { buildSearchVocabulary, expandSearchQuery, matchesExpandedQuery, relaxSearchQuery } from '../../packages/shared/src/search';
import { expandDiscoveryQuery, matchesDiscoveryQuery } from '../../apps/web/src/lib/product-discovery';
import { rankSuggestions, searchTerms } from '../../apps/api/src/domain/products/ProductSearchService';

/**
 * Brief N2 (2026-11-05), reproduced on https://shopgoldplus.com/shop?search=… and api /products?q=…:
 * "PDW2" found nothing while "PD W2", "GPW2" and "GP-W2-PB" found GP-W2; "power bank by carton" and
 * "wholesale flash disk" found nothing. Canonical SKUs, connectors, capacities and prices are untouched.
 */
const W2 = { id: 'w2', slug: 'goldplus-power-bank-gp-w2-pb', name: 'GoldPlus GP-W2 (PD-W2) Power Bank', categoryName: 'Power Devices', sku: 'GP-W2-PB', modelNumber: 'GP-W2 PB', retailPriceUgx: 110000, availability: { kind: 'in_stock' }, verifiedSpecs: {}, attributeValues: [] };
const W3 = { ...W2, id: 'w3', slug: 'goldplus-power-bank-gp-w3-pb', name: 'GoldPlus GP-W3 (PD-W3) Power Bank', sku: 'GP-W3-PB', modelNumber: 'GP-W3 PB' };
const DISK = { ...W2, id: 'f64', slug: 'goldplus-flash-disk-64gb', name: 'GoldPlus 64GB Flash Disk, USB 3.0 (Flash Drive)', categoryName: 'Storage Devices', sku: 'GP-64GB-F', modelNumber: 'GP-64GB F' };
const CATALOGUE = [W2, W3, DISK] as never[];
const find = (q: string) => {
  const e = expandDiscoveryQuery(CATALOGUE, q);
  return (CATALOGUE as typeof W2[]).filter((p) => matchesDiscoveryQuery(p as never, q, undefined, e.groups)).map((p) => p.sku);
};

describe('box code without separators', () => {
  it.each(['PDW2', 'pd-w2', 'PD W2', 'GPW2', 'GP-W2', 'GP-W2-PB'])('"%s" finds GP-W2 only (never W3)', (q) => {
    expect(find(q)).toEqual(['GP-W2-PB']);
  });
  it('the header suggestions agree', () => {
    expect(rankSuggestions('pdw2', [W2, W3] as never[]).map((c: { id: string }) => c.id)).toEqual(['w2']);
  });
});

describe('wholesale / by the carton', () => {
  it.each([
    ['power bank by carton', ['GP-W2-PB', 'GP-W3-PB']],
    ['wholesale power bank', ['GP-W2-PB', 'GP-W3-PB']],
    ['flash disk in wholesale', ['GP-64GB-F']],
    ['bulk flash drive', ['GP-64GB-F']],
  ])('"%s" searches the product words and flags bulk intent', (q, skus) => {
    expect(find(q)).toEqual(skus);
    expect(expandDiscoveryQuery(CATALOGUE, q).bulkIntent).toBe(true);
  });
  it('a query of bulk words only is left alone: nothing matches, no catalogue dump', () => {
    for (const q of ['wholesale', 'by carton', 'cartons']) {
      expect(find(q)).toEqual([]);
      expect(expandDiscoveryQuery(CATALOGUE, q).bulkIntent).toBeUndefined();
    }
  });
  it('the API side (shared expansion over searchTerms) drops the same words', () => {
    const vocab = buildSearchVocabulary(['GoldPlus GP-W2 (PD-W2) Power Bank', 'Power Devices']);
    const e = expandSearchQuery(searchTerms('power bank by carton'), vocab);
    expect(e.groups.flat()).not.toContain('carton');
    expect(e.groups.flat()).not.toContain('by');
    expect(matchesExpandedQuery('goldplus gp-w2 (pd-w2) power bank', e.groups)).toBe(true);
    expect(relaxSearchQuery({ ...e, unknown: ['x'], groups: [...e.groups, ['x']] })?.bulkIntent).toBe(true);
  });
});
