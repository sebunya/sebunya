import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProductPublicDto } from '@goldplus/shared';
import {
  DISCOVERY_TAXONOMY,
  dedupeProductsById,
  filterDiscoveryProducts,
  getProductSubcategory,
  normalizeCategoryParam,
  normalizeSearchParam,
  normalizeSubcategoryParam,
} from '../../apps/web/src/lib/product-discovery';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const shop = read('apps/web/src/pages/shop.astro');
const card = read('apps/web/src/components/ProductCard.astro');

function product(overrides: Partial<ProductPublicDto> = {}): ProductPublicDto {
  return {
    id: 'product-1',
    slug: 'usb-c-charger',
    name: 'USB-C Charger',
    categoryName: 'Power Devices',
    sku: null,
    modelNumber: null,
    retailPriceUgx: 45_000,
    availability: { kind: 'unknown' },
    hasImage: false,
    primaryImageUrl: null,
    verifiedSpecs: {},
    hasMissingSpecs: true,
    images: [],
    attributeValues: [],
    ...overrides,
  };
}

describe('Slice 05 product discovery P0', () => {
  it('renders a visible search input with an accessible label', () => {
    expect(shop).toContain('role="search"');
    expect(shop).toContain('for="shop-search"');
    expect(shop).toContain('id="shop-search"');
    expect(shop).toContain('name="search"');
  });

  it('uses exactly the approved category and subcategory taxonomy', () => {
    // 2026-08-08: PC Accessories (Mice, Sound Cards) joined as the fifth category.
    // 2026-08-26: Phone Batteries and MiFi & Router Batteries joined Power
    // Devices with the battery module. They are deliberately two shelves, not
    // one: a router battery is not a phone battery, and the finder, the
    // compatibility rules and the navigation all rely on the separation.
    expect(DISCOVERY_TAXONOMY.map(({ name }) => name)).toEqual([
      'Power Devices', 'Sound Devices', 'Storage Devices', 'Car Accessories', 'PC Accessories',
    ]);
    expect(DISCOVERY_TAXONOMY.flatMap(({ subcategories }) => subcategories.map(({ name }) => name))).toEqual([
      'Chargers', 'Power Banks', 'Phone Batteries', 'MiFi & Router Batteries',
      'Earbuds', 'Speakers', 'Flash Drives', 'Memory Cards', 'Mounts', 'Car Chargers', 'Mice', 'Sound Cards',
    ]);
  });

  it('normalizes search and allowlists direct-load filter parameters safely', () => {
    expect(normalizeSearchParam('  <script>alert(1)</script>  ')).toBe('script alert(1) /script');
    expect(normalizeSearchParam('   \n\t ')).toBe('');
    expect(normalizeCategoryParam('power')).toBe('power-devices');
    expect(normalizeCategoryParam('javascript:alert(1)')).toBe('');
    expect(normalizeSubcategoryParam('chargers', 'power-devices')).toBe('chargers');
    expect(normalizeSubcategoryParam('earbuds', 'power-devices')).toBe('');
  });

  it('supports case-insensitive name, category, model, and inferred subcategory search', () => {
    const charger = product({ modelNumber: 'GP-C20' });
    for (const search of ['usb-c', 'POWER DEVICES', 'gp-c20', 'chargers']) {
      expect(filterDiscoveryProducts([charger], { search, category: '', subcategory: '' })).toHaveLength(1);
    }
    expect(getProductSubcategory(charger)).toBe('chargers');
  });

  it('suppresses duplicate product IDs in rendered lists', () => {
    const duplicate = product({ slug: 'duplicate-slug' });
    expect(dedupeProductsById([product(), duplicate])).toHaveLength(1);
  });

  it('provides an honest zero-result state, reset, category browse, and labelled catalogue fallback', () => {
    expect(shop).toContain('No matching products yet.');
    expect(shop).toContain('Try another search or browse the categories.');
    expect(shop).toContain('href="/shop"');
    expect(shop).toContain('Browse available products');
    expect(shop).toContain('not personalised recommendations');
  });

  it('renders truthful UGX price and availability fallbacks without invalid price text', () => {
    expect(card).toContain('Number.isFinite(product.retailPriceUgx)');
    // 2026-08-08: currency now flows through the single formatUgx() source (UGX code
    // format, not the en-UG "USh" symbol) instead of an inline template literal.
    expect(card).toContain('formatUgx(product.retailPriceUgx!)');
    expect(card).toContain('Price on request');
    expect(card).toContain("default: return 'Confirm availability'");
    expect(card).not.toMatch(/\{\s*product\.retailPriceUgx\s*\}/);
  });

  it('uses clear and accessible PDP links and product-card labels', () => {
    expect(card).toContain('const productHref = searchQuery && searchRank > 0');
    expect(card).toContain(': `/products/${product.slug}`;');
    expect(card).toContain('href={productHref}');
    // 2026-08-08: the card was decluttered to a single affordance — the explicit
    // "View details" text link was removed. The whole card (image + name) links to
    // the PDP, and the accessible name is carried by the aria-label below, so the
    // PDP is still reachable and labelled without the redundant text link.
    expect(card).toContain('aria-label={`${product.name}, ${formattedPrice}, ${availabilityLabel}`}');
  });

  it('introduces no fake popularity, trending, scarcity, or recommendation claims', () => {
    expect(shop).not.toMatch(/Trending|Popular Searches|Best sellers|Recommended for you|CategoryPopularRail|fake urgency/i);
  });

  it('keeps Slice 5 runtime imports outside checkout, payment, auth, providers, Measurement, and PDP', () => {
    const imports = shop.split('---')[1] ?? '';
    expect(imports).not.toMatch(/from\s+['"][^'"]*(checkout|payment|pesapal|auth|zeptomail|whatsapp|measurement|telemetry|product-finder|recommendations|products\/\[slug\])/i);
  });
});
