import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { includesSearchTerm, numericSearchTermPattern } from '@goldplus/shared';
import { rankSuggestions } from '../../apps/api/src/domain/products/ProductSearchService';
import { SuggestProductsUseCase } from '../../apps/api/src/application/use-cases/products/SearchUseCases';
import { matchesDiscoveryQuery } from '../../apps/web/src/lib/product-discovery';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const card = (name: string) => ({ id: name, name, slug: name.toLowerCase().replace(/\s+/g, '-'), categoryName: 'Storage Devices', sku: 'X', modelNumber: 'Y' }) as never;
const CARDS = ['Memory Card 2GB', 'Memory Card 32GB', 'Memory Card 512GB', 'Flash Drive 2GB', 'Flash Drive 32GB', 'Memory Card 4GB', 'Memory Card 64GB', 'Memory Card 8GB', 'Memory Card 128GB'];

describe('a capacity is not the tail of a bigger capacity', () => {
  it('the shared rule', () => {
    expect(includesSearchTerm('memory card 2gb', '2gb')).toBe(true);
    expect(includesSearchTerm('memory card 32gb', '2gb')).toBe(false);
    expect(includesSearchTerm('memory card 512gb', '2gb')).toBe(false);
    expect(includesSearchTerm('card 32gb and 2gb', '2gb')).toBe(true);
    expect(includesSearchTerm('sd-2gb', '2gb')).toBe(true);
    // Words keep plain substring behaviour: prefix typing and joined words.
    expect(includesSearchTerm('powerbank 10000mah', 'bank')).toBe(true);
  });

  it('/shop and the dropdown pick the same sizes', () => {
    for (const [q, expected] of [
      ['2gb', ['Flash Drive 2GB', 'Memory Card 2GB']],
      ['4gb', ['Memory Card 4GB']],
      ['8gb', ['Memory Card 8GB']],
    ] as const) {
      const shop = CARDS.filter((n) => matchesDiscoveryQuery(card(n), q)).sort();
      const dropdown = rankSuggestions(q, CARDS.map((n) => ({ id: n, name: n, categoryName: 'Storage Devices' }))).map((c) => c.name).sort();
      expect(shop, q).toEqual([...expected]);
      expect(dropdown, q).toEqual([...expected]);
    }
  });

  it('the SQL applies the same rule to numeric words', () => {
    expect(numericSearchTermPattern('2gb')).toBe('(^|[^0-9])2gb');
    expect(numericSearchTermPattern('1.5m')).toBe('(^|[^0-9])1\\.5m');
    expect(numericSearchTermPattern('card')).toBeNull();
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts');
    const block = src.slice(src.indexOf('if (opts.search) {'), src.indexOf('if (opts.ids &&'));
    expect(block).toMatch(/numericSearchTermPattern\(term\)/);
    expect(block).toMatch(/~\* \$\{numeric\}/);
  });
});

describe('a subcategory word finds the same products in the dropdown as on /shop', () => {
  const rows = [
    { name: 'SanDisk Micro SD Memory Card 32GB', categoryName: 'Storage Devices' },
    { name: 'Heavy Duty Power Bank 20000mAh', categoryName: 'Power Devices' },
  ].map((r, i) => ({
    entity: { id: `p${i}`, name: r.name, slug: `p${i}`, sku: `S${i}`, modelNumber: null, subcategory: null },
    categoryName: r.categoryName,
    retailPriceUgx: 50_000,
    floorPriceUgx: null,
    images: [],
  }));

  // Mimics the SQL: every word must appear in the name or category (subcategory column is NULL).
  const repo = {
    findPublicViewList: async ({ search }: { search: string }) =>
      rows.filter((r) => search.toLowerCase().split(/\s+/).every((t) => `${r.entity.name} ${r.categoryName}`.toLowerCase().includes(t))),
  };

  it('"memory cards" and "power banks" are found with subcategory NULL', async () => {
    const uc = new SuggestProductsUseCase(repo as never, undefined, async () => (await import('@goldplus/shared')).DEFAULT_TAXONOMY);
    expect((await uc.execute({ query: 'memory cards' })).map((s) => s.id)).toEqual(['p0']);
    expect((await uc.execute({ query: 'power banks' })).map((s) => s.id)).toEqual(['p1']);
    expect(matchesDiscoveryQuery({ ...rows[0].entity, categoryName: 'Storage Devices' } as never, 'memory cards')).toBe(true);
  });

  it('a word that is not there still excludes the product', async () => {
    const uc = new SuggestProductsUseCase(repo as never, undefined, async () => (await import('@goldplus/shared')).DEFAULT_TAXONOMY);
    expect(await uc.execute({ query: 'memory cards samsung' })).toEqual([]);
  });
});
