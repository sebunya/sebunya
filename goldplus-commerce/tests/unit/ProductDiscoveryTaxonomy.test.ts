import { describe, expect, it } from 'vitest';
import {
  getProductSubcategory,
  normalizeCategoryParam,
  normalizeSubcategoryParam,
  filterDiscoveryProducts,
} from '../../apps/web/src/lib/product-discovery';
import { DEFAULT_TAXONOMY, type Taxonomy } from '@goldplus/shared';

const p = (name: string, categoryName = 'Power Devices'): any => ({
  id: name, name, categoryName, sku: 'SKU-' + name, modelNumber: 'M-' + name, retailPriceUgx: 1000,
});

describe('keyword inference (longest match wins, default taxonomy)', () => {
  it('prefers the more specific phrase: "car charger" → car-chargers, not chargers', () => {
    expect(getProductSubcategory(p('Anker Car Charger', 'Car Accessories'))).toBe('car-chargers');
  });
  it('"Power Bank" → power-banks (not chargers)', () => {
    expect(getProductSubcategory(p('Oraimo Power Bank'))).toBe('power-banks');
  });
  it('generic charger → chargers', () => {
    expect(getProductSubcategory(p('65W USB-C Charger'))).toBe('chargers');
  });
  it('memory card phrases → memory-cards', () => {
    expect(getProductSubcategory(p('SanDisk Micro SD 128GB', 'Storage Devices'))).toBe('memory-cards');
  });
  it('no keyword match → empty', () => {
    expect(getProductSubcategory(p('Mystery Gadget', 'PC Accessories'))).toBe('');
  });
});

describe('taxonomy is data-driven (a custom taxonomy changes behaviour)', () => {
  const custom: Taxonomy = [
    { slug: 'gadgets', name: 'Gadgets', showOnHomepage: true, aliases: ['g'], subcategories: [
      { slug: 'widgets', name: 'Widgets', keywords: ['widget'] },
    ] },
  ];
  it('normalizes an alias from the custom taxonomy', () => {
    expect(normalizeCategoryParam('g', custom)).toBe('gadgets');
    // a default-taxonomy alias is NOT valid under the custom taxonomy
    expect(normalizeCategoryParam('power', custom)).toBe('');
  });
  it('normalizes a subcategory from the custom taxonomy', () => {
    expect(normalizeSubcategoryParam('widgets', 'gadgets', custom)).toBe('widgets');
  });
  it('filters using the custom taxonomy category names', () => {
    const products = [p('A Widget', 'Gadgets'), p('A Charger', 'Power Devices')];
    const out = filterDiscoveryProducts(products, { search: '', category: 'gadgets', subcategory: '' }, custom);
    expect(out.map((x) => x.name)).toEqual(['A Widget']);
  });
});

describe('default taxonomy shape', () => {
  it('has the five approved categories', () => {
    expect(DEFAULT_TAXONOMY.map((c) => c.slug)).toEqual([
      'power-devices', 'sound-devices', 'storage-devices', 'car-accessories', 'pc-accessories',
    ]);
  });
  it('shows all five homepage tiles by default (tile brief: five, not four)', () => {
    expect(DEFAULT_TAXONOMY.filter((c) => c.showOnHomepage).map((c) => c.slug)).toEqual([
      'power-devices', 'sound-devices', 'storage-devices', 'car-accessories', 'pc-accessories',
    ]);
  });
});
