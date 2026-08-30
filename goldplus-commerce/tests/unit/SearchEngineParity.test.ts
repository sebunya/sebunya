import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { rankSuggestions, searchTerms, normalizeSearchQuery } from '../../apps/api/src/domain/products/ProductSearchService';
import { matchesDiscoveryQuery } from '../../apps/web/src/lib/product-discovery';

/**
 * The storefront has TWO search surfaces over one catalogue: the header's
 * predictive dropdown (API: SQL + rankSuggestions) and the /shop results page
 * (matchesDiscoveryQuery). They are separate code by necessity — one runs in
 * Postgres, one over an already-fetched list — so the risk is that they drift
 * and the dropdown reports "nothing found" for a term the results page has
 * products for. That is what these tests exist to catch.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

const product = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'p1',
    name: 'Heavy Duty Power Bank',
    slug: 'heavy-duty-power-bank',
    categoryName: 'Power Devices',
    sku: 'GP-PB-001',
    modelNumber: 'HD20K',
    approvalStatus: 'approved',
    active: true,
    ...over,
  }) as never;

describe('the dropdown and the results page match the same fields', () => {
  it('a category name finds the product on BOTH surfaces', () => {
    // The live defect: "sound" suggested nothing while /shop listed 3 products.
    expect(matchesDiscoveryQuery(product({ name: 'Heavy Duty Power Bank' }), 'power devices')).toBe(true);
    expect(
      rankSuggestions('power devices', [
        { id: 'p1', name: 'Heavy Duty Power Bank', sku: 'GP-PB-001', modelNumber: 'HD20K', categoryName: 'Power Devices' },
      ]),
    ).toHaveLength(1);
  });

  it('the suggestion SQL reads every field the results page reads', () => {
    const sql = read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts');
    const block = sql.slice(sql.indexOf('if (opts.search) {'), sql.indexOf('if (opts.ids &&'));
    for (const field of ['products.name', 'products.categoryName', 'products.subcategory', 'products.modelNumber', 'products.sku']) {
      expect(block, field).toContain(field);
    }
    // products.category_name is a denormalised copy of the joined category;
    // the storefront DTO shows the JOIN, so the query must match both or the
    // two surfaces diverge again the moment the copy goes stale.
    expect(block).toContain('db.select({ id: categories.id }).from(categories)');
  });

  it('ranking never discards a row the query matched', () => {
    // Scoring fewer fields than the SQL matches drops rows the repository
    // deliberately returned — an empty dropdown over a non-empty result set.
    const onlyCategory = rankSuggestions('storage', [
      { id: 'p1', name: 'Featherlight Cable', sku: 'X', modelNumber: 'Y', categoryName: 'Storage Devices' },
    ]);
    expect(onlyCategory).toHaveLength(1);
    const onlySubcategory = rankSuggestions('earbuds', [
      { id: 'p1', name: 'AudioMax 5', sku: 'X', modelNumber: 'Y', categoryName: 'Sound Devices', subcategory: 'Earbuds' },
    ]);
    expect(onlySubcategory).toHaveLength(1);
  });
});

describe('word order does not decide whether a customer finds a product', () => {
  const bank = product();

  it('every word must appear, in any order, on both surfaces', () => {
    for (const q of ['power bank', 'bank power', 'duty power', 'power   bank']) {
      expect(matchesDiscoveryQuery(bank, q), q).toBe(true);
      expect(rankSuggestions(q, [{ id: 'p1', name: 'Heavy Duty Power Bank', categoryName: 'Power Devices' }]), q).toHaveLength(1);
    }
  });

  it('a word that is not there still excludes the product', () => {
    expect(matchesDiscoveryQuery(bank, 'power bank samsung')).toBe(false);
    expect(rankSuggestions('power bank samsung', [{ id: 'p1', name: 'Heavy Duty Power Bank', categoryName: 'Power Devices' }])).toHaveLength(0);
  });

  it('a single word behaves exactly as the old substring match did', () => {
    expect(matchesDiscoveryQuery(bank, 'bank')).toBe(true);
    expect(matchesDiscoveryQuery(bank, 'charger')).toBe(false);
    expect(matchesDiscoveryQuery(bank, '')).toBe(true);
  });

  it('a match on the identifier still outranks a match buried in the category', () => {
    const ranked = rankSuggestions('hd20k', [
      { id: 'a', name: 'Unrelated Item', categoryName: 'hd20k things' },
      { id: 'b', name: 'Heavy Duty Power Bank', modelNumber: 'HD20K', categoryName: 'Power Devices' },
    ]);
    expect(ranked[0]?.id).toBe('b');
  });

  it('a pasted paragraph cannot become an unbounded pile of conditions', () => {
    expect(searchTerms(Array.from({ length: 40 }, (_, i) => `w${i}`).join(' '))).toHaveLength(6);
    expect(searchTerms('   ')).toEqual([]);
    expect(normalizeSearchQuery('Power   BANK ')).toBe('power bank');
  });
});
