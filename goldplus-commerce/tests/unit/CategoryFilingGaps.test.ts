import { describe, expect, it } from 'vitest';
import { DEFAULT_TAXONOMY } from '@goldplus/shared';
import { normalizeProductCategory, getCleanCatalog } from '../../apps/web/src/lib/catalog/catalog';
import { isListableProduct, isApprovedDiscoveryProduct, filterDiscoveryProducts } from '../../apps/web/src/lib/product-discovery';

/**
 * The storefront browses by the TAXONOMY (five categories); a product can only
 * be FILED into the `categories` table (three). The gap between those two lists
 * is bridged by a keyword guess, and these guard what that guess must and must
 * not do — the difference between a mis-filed product and an invisible one.
 */
const product = (name: string, categoryName: string) =>
  ({ id: name, name, slug: name.toLowerCase().replace(/\s+/g, '-'), categoryName, retailPriceUgx: 145_000 }) as never;

describe('a product is never silently removed from the shop', () => {
  it('an approved product in a category the storefront does not browse by still lists', () => {
    // It was dropped from /shop, from search and from every count: approved,
    // active, in stock and invisible.
    const orphan = product('Bluetooth Rugged Speaker Mk2', 'Other');
    expect(isApprovedDiscoveryProduct(orphan, DEFAULT_TAXONOMY)).toBe(false);
    expect(isListableProduct(orphan)).toBe(true);
  });

  it('it is findable by search even before it is filed', () => {
    const catalogue = [product('Widget Nine', 'Other')].filter(isListableProduct);
    expect(filterDiscoveryProducts(catalogue, { search: 'widget', category: '', subcategory: '' }, DEFAULT_TAXONOMY)).toHaveLength(1);
  });

  it('but it appears under no category chip until it is filed', () => {
    const catalogue = [product('Widget Nine', 'Other')].filter(isListableProduct);
    expect(filterDiscoveryProducts(catalogue, { search: '', category: 'power-devices', subcategory: '' }, DEFAULT_TAXONOMY)).toHaveLength(0);
  });

  it('junk without a slug or name is still refused', () => {
    expect(isListableProduct({ id: 'x', name: '', slug: '' } as never)).toBe(false);
  });
});

describe('an explicit filing beats the keyword guess', () => {
  it('a product filed under a real category keeps it, whatever its name says', () => {
    // "Car SD Card" filed under Storage was being moved to Car Accessories,
    // overriding the operator.
    const filed = product('Car SD Card', 'Storage Devices');
    expect(normalizeProductCategory(filed, DEFAULT_TAXONOMY).categoryName).toBe('Storage Devices');
    const sound = product('USB Drive Speaker', 'Sound Devices');
    expect(normalizeProductCategory(sound, DEFAULT_TAXONOMY).categoryName).toBe('Sound Devices');
  });

  it('the guess still rescues a product stranded in "Other"', () => {
    expect(normalizeProductCategory(product('USB 3.0 Flash Drive 128GB', 'Other'), DEFAULT_TAXONOMY).categoryName).toBe('Storage Devices');
    expect(normalizeProductCategory(product('Car Dashboard Mount', 'Other'), DEFAULT_TAXONOMY).categoryName).toBe('Car Accessories');
  });

  it('an unguessable product keeps its own category rather than being renamed', () => {
    expect(normalizeProductCategory(product('Rugged Speaker', 'Other'), DEFAULT_TAXONOMY).categoryName).toBe('Other');
  });

  it('the catalogue helper passes the live taxonomy down', () => {
    const out = getCleanCatalog([product('Car SD Card', 'Storage Devices')], DEFAULT_TAXONOMY);
    expect(out[0].categoryName).toBe('Storage Devices');
  });
});
