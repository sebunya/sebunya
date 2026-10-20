import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildSearchVocabulary,
  expandSearchQuery,
  matchesExpandedQuery,
  relaxSearchQuery,
  typoDistance,
} from '../../packages/shared/src/search';

// Product names as listed on shopgoldplus.com on 2026-10-20 (a sample of the 77), plus their categories.
const NAMES = [
  'GoldPlus GP-P06 10000mAh Compact Power Bank, 22.5W, Built-in USB-C and Lightning Cables',
  'GoldPlus GP-X01 Power Bank',
  'GoldPlus GP04 Wireless Earbuds',
  'GoldPlus GP-W05 Wireless Earphones, Bluetooth 5.4, Smart Touch, Noise Reduction',
  'GoldPlus GP-H06 Extra Bass Wired Earphones, 3.5mm Jack, Mic and Volume Buttons',
  'GoldPlus GP02BT Open-Style Bluetooth Headphones (OWS), LED Power Display, 4.5h Music',
  'GoldPlus GP-GAN01 65W GaN Fast Charger with Retractable USB-C Cable (UK plug)',
  'GoldPlus GP-C10 USB-C Wall Charger, UK Plug',
  'GoldPlus GP-CA03 Car Charger',
  'GoldPlus 32GB Memory Card (microSD, Class 10)',
  'GoldPlus 64GB Flash Disk, USB 3.0 (Flash Drive)',
  'GoldPlus Replacement Battery GP-39LT9 — fits the Spark 4 and the A56',
  'GoldPlus Camping Lamp',
];
const CATEGORIES = ['Power Devices', 'Sound Devices', 'Storage Devices', 'Car Accessories', 'PC Accessories'];
const vocab = buildSearchVocabulary([...NAMES, ...CATEGORIES]);
const expand = (q: string) => expandSearchQuery(q.toLowerCase().split(/\s+/).filter(Boolean), vocab);
const hits = (q: string) => NAMES.filter((n) => matchesExpandedQuery(n.toLowerCase(), expand(q).groups));

describe('the queries that ended on the zero-results page on 2026-10-20 now find products', () => {
  it('"powerbank" finds the power banks, in the shop\'s words', () => {
    expect(expand('powerbank').display).toBe('power bank');
    expect(hits('powerbank')).toHaveLength(2);
  });

  it('"chager" is a typo for charger, and says so', () => {
    const q = expand('chager');
    expect(q.corrections).toEqual([{ from: 'chager', to: 'charger' }]);
    expect(hits('chager')).toHaveLength(3);
  });

  it('"earpods" finds earbuds (a synonym, not a correction)', () => {
    const q = expand('earpods');
    expect(q.display).toBe('earbuds');
    expect(q.corrections).toEqual([]);
    expect(hits('earpods')).toContain('GoldPlus GP04 Wireless Earbuds');
  });

  it('"lapotp charger": the unknown word is reported, and relaxing it leaves the chargers', () => {
    const q = expand('lapotp charger');
    expect(q.unknown).toEqual(['lapotp']);
    expect(NAMES.filter((n) => matchesExpandedQuery(n.toLowerCase(), q.groups))).toEqual([]);
    const relaxed = relaxSearchQuery(q)!;
    expect(relaxed.display).toBe('charger');
    expect(NAMES.filter((n) => matchesExpandedQuery(n.toLowerCase(), relaxed.groups))).toHaveLength(3);
  });
});

describe('what must not change', () => {
  it('exact words and prefix typing behave as before', () => {
    expect(expand('power bank').groups).toEqual([['power bank', 'powerbank', 'power-bank', 'portable charger']]);
    expect(expand('earb')).toMatchObject({ groups: [['earb']], corrections: [], unknown: [] });
    expect(hits('car charger')).toEqual(['GoldPlus GP-CA03 Car Charger']);
  });

  it('numbers are never "corrected", and "2gb" still never finds 32GB', () => {
    expect(expand('2gb')).toMatchObject({ groups: [['2gb']], corrections: [] });
    expect(hits('2gb')).toEqual([]);
    expect(hits('32gb')).toEqual(['GoldPlus 32GB Memory Card (microSD, Class 10)']);
  });

  it('a real word the shop does not stock is not bent into one it does', () => {
    // Different first letter, or too far: no correction.
    expect(expand('mouse').corrections).toEqual([]);
    expect(expand('speaker').corrections).toEqual([]);
    expect(expand('fan')).toMatchObject({ groups: [['fan']], corrections: [], unknown: ['fan'] }); // honest: not stocked
  });

  it('plurals reach the singular', () => {
    expect(expand('batteries').display).toBe('battery');
    expect(hits('chargers')).toHaveLength(3);
  });

  it('relaxing never drops every word and never runs when nothing was unknown', () => {
    expect(relaxSearchQuery(expand('lapotp'))).toBeNull();
    expect(relaxSearchQuery(expand('charger'))).toBeNull();
  });

  it('typo distance counts a swap as one', () => {
    expect(typoDistance('chagrer', 'charger', 2)).toBe(1);
    expect(typoDistance('abc', 'xyz', 1)).toBe(2);
  });
});

// ── Both engines, end to end ────────────────────────────────────────────────
import { searchDiscoveryProducts } from '../../apps/web/src/lib/product-discovery';
import { SuggestProductsUseCase } from '../../apps/api/src/application/use-cases/products/SearchUseCases';
import { buildSearchVocabulary as vocabOf, matchesExpandedQuery as matchGroups } from '../../packages/shared/src/search';
import { DEFAULT_TAXONOMY } from '../../packages/shared/src';

const CATALOGUE = NAMES.map((name, i) => ({
  id: `p${i}`,
  name,
  slug: `p${i}`,
  categoryName: /earb|earph|headph/i.test(name) ? 'Sound Devices' : /card|flash/i.test(name) ? 'Storage Devices' : /car charger/i.test(name) ? 'Car Accessories' : 'Power Devices',
  sku: null,
  modelNumber: null,
  retailPriceUgx: 10_000,
}));

/** A repository that matches like the SQL: every group, any alternative, over the same fields. */
const repo = {
  searchVocabulary: async () => vocabOf(CATALOGUE.flatMap((p) => [p.name, p.categoryName])),
  findPublicViewList: async (opts: { search?: string; searchGroups?: string[][] } = {}) =>
    CATALOGUE.filter((p) => {
      const groups = opts.searchGroups ?? (opts.search ? opts.search.toLowerCase().split(/\s+/).map((t) => [t]) : null);
      return !groups || matchGroups(`${p.name} ${p.categoryName}`.toLowerCase(), groups);
    }).map((p) => ({
      entity: { id: p.id, name: p.name, slug: p.slug, sku: null, modelNumber: null, subcategory: null },
      categoryName: p.categoryName,
      retailPriceUgx: 10_000,
      floorPriceUgx: null,
      images: [],
    })),
};

describe('the dropdown and /shop give the same answer to the queries that failed', () => {
  const shop = (q: string) => searchDiscoveryProducts(CATALOGUE as never, { search: q, category: '', subcategory: '' });
  const dropdown = (q: string) => new SuggestProductsUseCase(repo as never, undefined, async () => DEFAULT_TAXONOMY).execute({ query: q, limit: 12 });

  for (const q of ['powerbank', 'chager', 'earpods', 'batteries', 'lapotp charger']) {
    it(`"${q}"`, async () => {
      const page = shop(q).products.map((p) => p.name).sort();
      const menu = (await dropdown(q)).map((s) => s.name).sort();
      expect(page.length, q).toBeGreaterThan(0);
      expect(menu, `${q}: shop=${JSON.stringify(page)} menu=${JSON.stringify(menu)}`).toEqual(page);
    });
  }

  it('/shop says what it did: a typo fixed, or a word left out', () => {
    expect(shop('chager')).toMatchObject({ searchedFor: 'charger', corrections: [{ from: 'chager', to: 'charger' }], dropped: [] });
    expect(shop('lapotp charger')).toMatchObject({ searchedFor: 'charger', dropped: ['lapotp'] });
    expect(shop('powerbank')).toMatchObject({ searchedFor: 'power bank', corrections: [], dropped: [] });
  });

  it('a query whose words the shop knows but no product has together stays empty (no unrelated products)', () => {
    expect(shop('earbuds charger').products).toEqual([]);
  });

  it('/shop shows the note and records a relaxed search as a miss', () => {
    const page = readFileSync(new URL('../../apps/web/src/pages/shop.astro', import.meta.url), 'utf8');
    expect(page).toContain('Showing results for “${searchResult.searchedFor}”.');
    expect(page).toContain('(left out: ${searchResult.dropped.join(\', \')})');
  });
});
