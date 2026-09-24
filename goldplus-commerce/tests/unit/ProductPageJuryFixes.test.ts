import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeRecentlyViewedItems } from '../../apps/web/src/components/recommendations/recentlyViewedItems';
import { isZoomTap, zoomSourceOf, ZOOM_TAP_SLOP_PX } from '../../apps/web/src/components/product/galleryZoom';
import { filterDisplayableRecommendations } from '../../apps/web/src/lib/recommendation-display';

/**
 * 2026-09-24 awards-jury review, product group: the PDP, its rails, the cards
 * and the finder. Behaviour first; source pins only where the behaviour lives
 * in a template.
 */

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const pdp = read('apps/web/src/pages/products/[slug].astro');
const rv = read('apps/web/src/components/recommendations/RecentlyViewedRail.astro');
const recCard = read('apps/web/src/components/recommendations/RecommendationCard.astro');
const card = read('apps/web/src/components/ProductCard.astro');
const related = read('apps/web/src/components/recommendations/RelatedProductsRail.astro');
const gallery = read('apps/web/src/components/product/ProductGallery.astro');
const finder = read('apps/web/src/components/product-finder/ProductFinderShell.astro');

const p = (productId: string) => ({ productId, slug: `p-${productId}` });

describe('the browse rail never recommends the page to itself', () => {
  it('a first visit (history = the current product only) shows the server fallback, not the product itself', () => {
    const out = composeRecentlyViewedItems([p('current')], [p('a'), p('b'), p('current'), p('c'), p('d')], {
      excludeProductId: 'current',
      alwaysRender: true,
    });
    expect(out.map((x) => x.item.productId)).toEqual(['a', 'b', 'c', 'd']);
    expect(out.every((x) => x.source === 'fallback')).toBe(true);
  });

  it('a short history is topped up from the fallback without duplicates, history first', () => {
    const out = composeRecentlyViewedItems([p('current'), p('x'), p('a')], [p('a'), p('b'), p('c')], {
      excludeProductId: 'current',
      alwaysRender: true,
    });
    expect(out.map((x) => `${x.source}:${x.item.productId}`)).toEqual(['history:x', 'history:a', 'fallback:b', 'fallback:c']);
  });

  it('the returning-visitor rail (no alwaysRender) never pads with fallback', () => {
    const out = composeRecentlyViewedItems([p('x')], [p('a')], { alwaysRender: false });
    expect(out.map((x) => x.item.productId)).toEqual(['x']);
  });

  it('caps at four cards and is empty when there is honestly nothing to show', () => {
    expect(composeRecentlyViewedItems([p('1'), p('2'), p('3'), p('4'), p('5')], [], { alwaysRender: true })).toHaveLength(4);
    expect(composeRecentlyViewedItems([p('current')], [p('current')], { excludeProductId: 'current', alwaysRender: true })).toEqual([]);
  });

  it('the PDP passes its own product id and the rail uses the shared rule', () => {
    expect(pdp).toContain('excludeProductId={product.id}');
    expect(rv).toContain('data-exclude-product-id=');
    expect(rv).toContain('composeRecentlyViewedItems(');
    // Per-card reason: a fallback card is labelled as fallback even beside history.
    expect(rv).toContain("source === 'fallback' ? 'RECENTLY_VIEWED_FALLBACK' : 'RECENTLY_VIEWED'");
  });
});

describe('card buttons: one hierarchy, no broken labels on phones', () => {
  for (const [name, src] of [['ProductCard', card], ['RecommendationCard', recCard], ['RecentlyViewedRail', rv]] as const) {
    it(`${name}: Add to cart is the lime primary (as on the PDP), labels never wrap inside a pill`, () => {
      const add = src.indexOf('Add to cart</button>');
      const buy = src.indexOf('Buy now</button>');
      expect(add).toBeGreaterThan(-1);
      expect(buy).toBeGreaterThan(add);
      // The lime fill belongs to the Add to cart button (between the form and its label)…
      const addButton = src.slice(src.lastIndexOf('<button', add), add);
      const buyButton = src.slice(src.lastIndexOf('<button', buy), buy);
      expect(addButton).toContain('background:#93D500');
      expect(buyButton).not.toContain('background:#93D500');
      // …and two labels that cannot share a narrow card stack instead of breaking.
      expect(addButton).toContain('whitespace-nowrap');
      expect(buyButton).toContain('whitespace-nowrap');
      expect(src).toMatch(/action="\/cart" class=[^>]*flex flex-wrap/);
    });
  }

  it('the rail reason is an eyebrow in the text column, not a pill over the image', () => {
    expect(recCard).not.toContain('absolute top-3 right-3 z-10');
    expect(recCard).toMatch(/\{displayReason && \(\s*<p class="mb-1 text-\[11px\] font-bold uppercase tracking-wider text-brand-primaryInk">/);
  });

  it('one missing-photo wording at a readable contrast on every card', () => {
    for (const src of [card, recCard, rv]) {
      expect(src).toContain('Image unavailable');
      expect(src).not.toContain('Image pending');
      expect(src).not.toMatch(/text-brand-mutedGrey\/(40|50)/);
    }
  });
});

describe('Similar products prefers the same product family', () => {
  it('the display boundary puts same-subcategory items first when asked (the rail asks)', () => {
    const items = [
      { productId: 'b1', slug: 'battery-1', name: 'Battery 1', subcategoryName: 'phone-batteries', reasonCode: 'SAME_CATEGORY', price: 18000 },
      { productId: 'b2', slug: 'battery-2', name: 'Battery 2', subcategoryName: 'phone-batteries', reasonCode: 'SAME_CATEGORY', price: 18000 },
      { productId: 'c1', slug: 'charger-1', name: 'Charger 1', subcategoryName: 'chargers', reasonCode: 'SAME_CATEGORY', price: 25000 },
    ];
    const out = filterDisplayableRecommendations(items as any, {
      currentProductId: 'c0',
      currentProductSlug: 'charger-0',
      currentSubcategory: 'chargers',
      minimumSameSubcategoryCandidates: 1,
      limit: 4,
    });
    expect(out.map((x) => x.productId)).toEqual(['c1', 'b1', 'b2']);
    // The engine's reason is kept — only the order changed.
    expect(out.every((x) => x.reasonCode === 'SAME_CATEGORY')).toBe(true);
  });

  it('the rail passes the subcategory and a wider slice, and keeps the Similar products title', () => {
    expect(related).toContain('currentSubcategory: subcategoryName || undefined');
    expect(related).toContain('limit: 16');
    expect(related).toContain('limit: 4');
    expect(related).toContain('"Similar products"');
  });
});

describe('the PDP buy area', () => {
  it('a sticky buy bar exists only for buyable products, starts hidden, and submits the SAME form', () => {
    expect(pdp).toContain('<form id="pdp-buy" method="POST" action="/cart"');
    expect(pdp).toMatch(/\{canBuy && \(\s*<div data-pdp-buybar hidden class="lg:hidden fixed/);
    expect(pdp).toContain('form="pdp-buy"');
    expect(pdp).toContain('buyBar.hidden = formInView || footerInView;');
  });

  it('returns and payment are stated beside the decision, from their single sources', () => {
    expect(pdp).toContain("import { RETURNS_POLICY } from '../../lib/returnsPolicy'");
    expect(pdp).toContain('{RETURNS_POLICY.windowDays}-day returns if unused and complete');
    expect(pdp).toContain('storefrontCopy.payment.pesapal.label');
    expect(pdp).toContain('storefrontCopy.payment.offline.label');
    expect(pdp).not.toMatch(/free returns|\d+-day returns/i);
  });

  it('Buy now has a focus ring that can be seen (it was a 20% grey at 1.44:1)', () => {
    expect(pdp).not.toContain('focus-visible:ring-gray-900/20');
  });

  it('purchase information is no longer set in 9-10px type', () => {
    expect(pdp).not.toMatch(/text-\[9px\]/);
    expect(pdp).not.toMatch(/<th scope="row"[^>]*text-\[10px\]/);
    expect(pdp).toContain('>Specifications</h2>');
  });

  it('verified specifications come before category filler above the buy button', () => {
    expect(pdp).toContain('const keySpecs = verifiedAttributes.slice(0, 3)');
    expect(pdp).toContain('aria-label="Key specifications"');
    expect(pdp).toContain('aria-label="Highlights"');
    expect(pdp).not.toContain('aria-label="Key facts"');
  });

  it('the compatibility link promises only what it opens', () => {
    expect(pdp).not.toContain('See what works with this');
    expect(pdp).toContain('href="#compat-heading"');
    expect(pdp).toContain('Not sure what you need? Answer 4 quick questions');
  });

  it('the desktop gallery stays in view beside the long details column', () => {
    expect(pdp).toContain('lg:shrink-0 lg:sticky lg:top-6 lg:self-start');
  });
});

describe('gallery zoom', () => {
  it('a tap or click opens it; a swipe or scroll never does', () => {
    expect(isZoomTap(null, { x: 5, y: 5 })).toBe(true);
    expect(isZoomTap({ x: 100, y: 100 }, { x: 104, y: 97 })).toBe(true);
    expect(isZoomTap({ x: 100, y: 100 }, { x: 100 - 60, y: 102 })).toBe(false);
    expect(isZoomTap({ x: 100, y: 100 }, { x: 101, y: 100 + ZOOM_TAP_SLOP_PX + 1 })).toBe(false);
  });

  it('only a same-origin path or http(s) URL is ever enlarged', () => {
    expect(zoomSourceOf('/uploads/assets/ab/cd/pdp.webp')).toBe('/uploads/assets/ab/cd/pdp.webp');
    expect(zoomSourceOf('javascript:alert(1)')).toBe('');
    expect(zoomSourceOf('//evil.example/x.png')).toBe('');
  });

  it('is a native dialog with a keyboard route and a zoom-in cursor', () => {
    expect(gallery).toContain('<dialog class="gp-gallery__zoom" data-gallery-zoom');
    expect(gallery).toContain('data-gallery-zoom-open hidden>Enlarge image</button>');
    expect(gallery).toContain('cursor: zoom-in');
    expect(gallery).toContain('dialog.showModal()');
  });
});

describe('the product finder speaks the site design language', () => {
  it('no white text on lime (1.92:1), no off-token lime or green', () => {
    expect(finder).not.toMatch(/#96cc06|#659000/i);
    expect(finder).not.toMatch(/bg-brand-primary[^'"`]*text-white|text-white[^'"`]*bg-brand-primary/);
    expect(finder).toContain('bg-brand-primary text-sm font-bold text-brand-black');
  });
});
