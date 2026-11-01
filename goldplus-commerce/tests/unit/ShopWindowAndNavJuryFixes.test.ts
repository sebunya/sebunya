import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProductPublicDto } from '@goldplus/shared';
import { hasRealCover, isSampleAlt, preferIds, realCoversFirst } from '../../apps/web/src/lib/productCover';
import { buildHomepageProductAllocation } from '../../apps/web/src/lib/homepage-merchandising';
import { matchesDiscoveryQuery } from '../../apps/web/src/lib/product-discovery';

/**
 * Awards-jury review, 2026-09-24 (group nav_home). Each block pins one
 * confirmed finding so the fix cannot quietly regress.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

const SAMPLE_ALT = 'Sample image (no photo of this product yet) — GoldPlus Battery GP-11CT';

function product(id: string, cover: 'real' | 'sample' | 'none', over: Partial<ProductPublicDto> = {}): ProductPublicDto {
  const url = cover === 'none' ? null : `/uploads/assets/${id}/pdp.webp`;
  return {
    id,
    slug: id,
    name: `Product ${id}`,
    categoryName: 'Power Devices',
    shortDescription: null,
    longDescription: null,
    sku: null,
    modelNumber: null,
    retailPriceUgx: 150_000,
    floorPriceUgx: null,
    availability: { kind: 'in_stock', quantity: 200 },
    hasImage: cover !== 'none',
    primaryImageUrl: url,
    verifiedSpecs: {},
    hasMissingSpecs: false,
    images: url ? [{ url, alt: cover === 'sample' ? SAMPLE_ALT : `Product ${id} on white` }] : [],
    attributeValues: [],
    ...over,
  };
}

describe('the shop window is filled from real photography first', () => {
  it('a sample frame is not a real cover; a photo is; no image is neither', () => {
    expect(isSampleAlt(SAMPLE_ALT)).toBe(true);
    expect(isSampleAlt('Samples of our range')).toBe(false);
    expect(hasRealCover(product('a', 'real'))).toBe(true);
    expect(hasRealCover(product('b', 'sample'))).toBe(false);
    expect(hasRealCover(product('c', 'none'))).toBe(false);
  });

  it('the cover is the image at primaryImageUrl, not whichever image comes first', () => {
    const p = product('d', 'real', {
      images: [
        { url: '/uploads/other.webp', alt: SAMPLE_ALT },
        { url: '/uploads/assets/d/pdp.webp', alt: 'A real photo' },
      ],
    });
    expect(hasRealCover(p)).toBe(true);
  });

  it('the partition is stable and drops nothing', () => {
    const list = [product('s1', 'sample'), product('r1', 'real'), product('s2', 'sample'), product('r2', 'real')];
    expect(realCoversFirst(list).map((p) => p.id)).toEqual(['r1', 'r2', 's1', 's2']);
    expect(preferIds(['x', 'y', 'z'], new Set(['z']), (v) => v)).toEqual(['z', 'x', 'y']);
    expect(preferIds(['x', 'y'], new Set(), (v) => v)).toEqual(['x', 'y']);
  });

  it('featured, promo and pick take the photographed products before any sample frame', () => {
    // The live order: batteries (sample frames) first, the photographed range last.
    const catalogue = [
      ...Array.from({ length: 8 }, (_, i) => product(`s${i}`, 'sample')),
      product('r1', 'real'), product('r2', 'real'), product('r3', 'real'),
    ];
    const allocation = buildHomepageProductAllocation(catalogue);
    expect(allocation.featuredProducts.map((p) => p.id)).toEqual(['r1', 'r2', 'r3', 's0']);
    // Owner decision 2026-09-24: the two highlight cards only ever show a
    // photographed product. With none left after Featured, they are hidden.
    expect(allocation.promoProduct).toBeNull();
    expect(allocation.todaysPickProduct).toBeNull();
    expect(allocation.hiddenSections.promo).toBe(true);
    expect(allocation.hiddenSections.todaysPick).toBe(true);
  });

  it('the highlight cards take the next photographed products, never a sample frame', () => {
    const catalogue = [
      ...Array.from({ length: 5 }, (_, i) => product(`s${i}`, 'sample')),
      ...Array.from({ length: 5 }, (_, i) => product(`r${i}`, 'real')),
    ];
    const allocation = buildHomepageProductAllocation(catalogue);
    expect(allocation.featuredProducts.map((p) => p.id)).toEqual(['r0', 'r1', 'r2', 'r3']);
    expect(allocation.promoProduct?.id).toBe('r4');
    // Only one photographed product was left: the second card hides.
    expect(allocation.todaysPickProduct).toBeNull();
    expect(allocation.trendingProducts.map((p) => p.id)).toEqual(['s0', 's1', 's2', 's3']);
  });

  it('the header feature cards and the browse rail use the same rule', () => {
    expect(read('apps/web/src/lib/navFeatured.ts')).toContain('hasRealCover(p)');
    const rail = read('apps/web/src/components/recommendations/PopularNowRail.astro');
    expect(rail).toContain('preferIds(response.items');
    // An evidence-backed popularity list keeps the engine's order.
    expect(rail).toContain('!claimsPopularity(finalItems)');
    expect(rail).toContain('if (!claimsPopularity(photoFirst))');
    expect(read('apps/web/src/pages/index.astro')).toContain('allProducts.filter(hasRealCover)');
  });
});

describe('header navigation: pointer, keyboard and phone', () => {
  const nav = read('apps/web/src/components/GpNav.astro');

  it('resting on the scrim closes a hover-opened panel; coming back keeps it', () => {
    expect(nav).toMatch(/scrim\.addEventListener\('mouseenter', function\(\)\{ if \(mq\(\)\) return; clearTimeout\(closeT\); closeT = setTimeout\(close, 260\); \}\);/);
    expect(nav).toContain("mega.addEventListener('mouseenter', function(){ clearTimeout(closeT); });");
  });

  it('focus leaving the header closes the panel and the search sheet (WCAG 2.4.11)', () => {
    expect(nav).toContain("nav.addEventListener('focusout'");
    expect(nav).toContain("form.addEventListener('focusout'");
    // A click that does not move focus (Safari links) must not close under the pointer.
    expect(nav).toContain("!nav.matches(':hover')");
  });

  it('focus no longer opens panels; ArrowDown opens one and moves into it', () => {
    expect(nav).toContain("el.addEventListener('focus', function(){ if (!mq()) moveSpark(el); });");
    expect(nav).not.toMatch(/addEventListener\('focus', function\(\)\{\s*if \(mq\(\)\) return;\s*if \(id\) show\(id, el\)/);
    expect(nav).toContain("e.key !== 'ArrowDown'");
  });

  it('the closed phone drawer and collapsed accordions leave the tab order', () => {
    expect(nav).toMatch(/transform:translateY\(-100%\);visibility:hidden;/);
    expect(nav).toContain('.gp-nav[data-open] .gp-nav__mega{transform:none;max-height:none;grid-template-rows:none;visibility:visible;transition-delay:0s;}');
    expect(nav).toMatch(/\.gp-nav__acc ul\{[^}]*visibility:hidden;/);
    expect(nav).toContain('.gp-nav__acc[data-exp] ul{max-height:360px;visibility:visible;transition-delay:0s;}');
    // The page behind the open drawer is inert, and never stranded that way.
    expect(nav).toContain('inert(true)');
    expect(nav).toContain('inert(false)');
  });

  it('"Start here" promises only what the shop can do', () => {
    expect(nav).not.toContain('Best sellers');
    expect(nav).not.toContain('New this month');
    expect(nav).toContain('<a href="/shop?sort=price-low-high">Lowest prices first</a>');
    expect(read('apps/web/src/pages/shop.astro')).toContain("sort: 'price-low-high'");
  });

  it('the rail marks the category the shopper is in, not Shop All', () => {
    expect(nav).toContain("cq.indexOf(hc + '-') === 0");
    expect(nav).not.toContain("el.getAttribute('href') === location.pathname");
  });

  it('the top bar does not send a shopper from checkout back to the cart', () => {
    expect(nav).toContain('var inFunnel = /^\\/(cart|checkout)(\\/|$)/.test(location.pathname);');
    expect(nav).toContain("CTX.cart > 0 && CTX.beforeCutoff && !inFunnel");
    expect(nav).toContain("CTX.cart > 0 && !CTX.beforeCutoff && !inFunnel");
  });

  it('the phone search icon stays in the field and a first visit gets somewhere to start', () => {
    expect(nav).toContain('.gp-nav__msearch > svg{position:absolute;left:16px;top:25px;');
    expect(nav).toContain('Start with');
  });
});

describe('shop search: a phone brand finds the batteries named for its phones', () => {
  const battery = (name: string) => product('bat', 'sample', { name, categoryName: 'Power Devices' });

  it('"tecno spark 4" finds the battery that fits the Spark 4', () => {
    const b = battery('GoldPlus Replacement Battery GP-39LT9 — fits the Spark 4');
    expect(matchesDiscoveryQuery(b, 'tecno spark 4')).toBe(true);
    expect(matchesDiscoveryQuery(b, 'tecno')).toBe(true);
    expect(matchesDiscoveryQuery(b, 'Tecno Spark 4')).toBe(true);
  });

  it('a line shared by several makers is not an alias, and the wrong brand stays out', () => {
    expect(matchesDiscoveryQuery(battery('Battery for Redmi Note 8'), 'infinix')).toBe(false);
    expect(matchesDiscoveryQuery(battery('Battery for Redmi Note 8'), 'xiaomi')).toBe(true);
    expect(matchesDiscoveryQuery(battery('Battery for Galaxy A10'), 'samsung')).toBe(true);
    expect(matchesDiscoveryQuery(battery('Battery for Galaxy A10'), 'tecno')).toBe(false);
    expect(matchesDiscoveryQuery(battery('Battery GP-11CT'), 'tecno spark 4')).toBe(false);
  });

  it('a query word that names an object property cannot break the matcher', () => {
    expect(matchesDiscoveryQuery(battery('Battery GP-11CT'), 'constructor')).toBe(false);
    expect(matchesDiscoveryQuery(battery('Battery GP-11CT'), '__proto__')).toBe(false);
  });
});

describe('shop page: zero results, category headings, density', () => {
  const shop = read('apps/web/src/pages/shop.astro');

  it('a search that found nothing offers a person, not zero-result chips or a bulk form', () => {
    expect(shop).toContain("const chipSearch = zeroResults ? '' : search;");
    expect(shop).toContain('shopUrl({ search: chipSearch, category: item.slug');
    expect(shop).toContain('Ask us on WhatsApp');
    expect(shop).not.toContain('Ask us for “{search}”');
    expect(shop).toContain('Buying in bulk?');
    expect(shop).toContain('Nothing matched “${search}”.');
    expect(shop).toContain("'1 product matches your search.'");
  });

  it('a category page is headed by its category, in customer words', () => {
    expect(shop).toContain("subcategoryLabel || categoryLabel || 'Find a GoldPlus product'");
    expect(shop).toContain('selectedCategory?.description');
    expect(shop).not.toContain('approved product categories');
  });

  it('fewer stacked controls above the first product', () => {
    expect(shop).toContain('{products.length > 1 && (');
    expect(shop).toContain('!onlyCategoryFilter');
    // Hidden from 981px, where the header search appears (lg: began at 1024px).
    expect(shop).toMatch(/role="search" class="shop-search [^"]*"/);
    expect(shop).toContain('@media (min-width: 981px) { .shop-search { display: none; } }');
    expect(shop).toContain('pageNumbers.map');
  });
});

describe('home rhythm', () => {
  const home = read('apps/web/src/pages/index.astro');

  it('grids have no orphan rows at tablet widths', () => {
    expect(home).toContain('<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">');
    expect(home).toContain('<div class="grid grid-cols-2 lg:grid-cols-5 gap-3.5">');
  });

  it('the browse rail sits on the home column in its own band', () => {
    expect(home).toContain('homeBand={true}');
    const rail = read('apps/web/src/components/recommendations/PopularNowRail.astro');
    expect(rail).toContain('<div class="bg-white border-b border-slate-100 flex flex-col">');
    expect(rail).toContain('<div class="container mx-auto px-4 lg:px-8">');
  });

  it('the footer uses two columns on a phone', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toContain('<div class="grid grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1.05fr] gap-10 lg:gap-8">');
    expect(layout).toContain('<div class="flex flex-col max-lg:col-span-2">');
  });
});
