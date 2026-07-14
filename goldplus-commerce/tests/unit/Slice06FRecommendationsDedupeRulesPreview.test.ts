import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProductPublicDto } from '@goldplus/shared';
import {
  dedupeRecommendations,
  formatRecommendationPrice,
  isDisplayableRecommendation,
  normalizeRecommendationCandidate,
  previewRecommendationRules,
  productToRecommendationItem,
  recommendationAvailabilityLabel,
  REVIEWED_COMPLEMENTARY_SUBCATEGORIES,
  supportedRecommendationReason,
} from '../../apps/web/src/lib/recommendation-display';

const read = (file: string) => readFileSync(resolve(__dirname, '../..', file), 'utf8');
const relatedRail = read('apps/web/src/components/recommendations/RelatedProductsRail.astro');
const completeRail = read('apps/web/src/components/recommendations/CompleteSetupRail.astro');
const popularRail = read('apps/web/src/components/recommendations/PopularNowRail.astro');
const categoryRail = read('apps/web/src/components/recommendations/CategoryPopularRail.astro');
const recommendationRail = read('apps/web/src/components/recommendations/RecommendationRail.astro');
const recentlyViewedRail = read('apps/web/src/components/recommendations/RecentlyViewedRail.astro');
const card = read('apps/web/src/components/recommendations/RecommendationCard.astro');
const previewPanel = read('apps/web/src/components/recommendations/RecommendationRulePreviewPanel.astro');
const previewPage = read('apps/web/src/pages/admin/recommendations/preview.astro');
const pdp = read('apps/web/src/pages/products/[slug].astro');

function product(
  id: string,
  slug: string,
  categoryName = 'Power Devices',
  name = `Product ${id}`,
): ProductPublicDto {
  return {
    id,
    slug,
    name,
    categoryName,
    sku: null,
    modelNumber: null,
    retailPriceUgx: null,
    availability: { kind: 'unknown' },
    hasImage: false,
    primaryImageUrl: null,
    verifiedSpecs: {},
    hasMissingSpecs: true,
    images: [],
    attributeValues: [],
  };
}

const candidate = (
  id: string,
  slug: string,
  categoryName = 'Power Devices',
  subcategoryName = '',
) => ({ id, slug, name: `Product ${id}`, categoryName, subcategoryName });

describe('Slice 06-F elite recommendations intelligence', () => {
  it('normalises a slug-only candidate with a stable rendering identity', () => {
    const normalized = normalizeRecommendationCandidate({ slug: 'slug-only', name: 'Slug only' });
    expect(normalized).toMatchObject({ id: 'slug-only', slug: 'slug-only', eligible: true });
  });

  it('rejects candidates without both a stable identity and a safe PDP slug', () => {
    expect(isDisplayableRecommendation({ name: 'No identity' })).toBe(false);
    expect(isDisplayableRecommendation({ id: 'id-only', name: 'No slug' })).toBe(false);
  });

  it('rejects missing product names and unsafe or stale slugs', () => {
    expect(isDisplayableRecommendation({ id: '1', slug: 'missing-name' })).toBe(false);
    expect(isDisplayableRecommendation({ id: '1', slug: '../unsafe', name: 'Unsafe' })).toBe(false);
    expect(isDisplayableRecommendation({ id: '1', slug: 'generic-fast-charger', name: 'Stale' })).toBe(false);
  });

  it('rejects hidden, archived, inactive and deleted candidates', () => {
    expect(isDisplayableRecommendation({ id: '1', slug: 'hidden', name: 'Hidden', hidden: true })).toBe(false);
    expect(isDisplayableRecommendation({ id: '1', slug: 'archived', name: 'Archived', archived: true })).toBe(false);
    expect(isDisplayableRecommendation({ id: '1', slug: 'inactive', name: 'Inactive', isActive: false })).toBe(false);
    expect(isDisplayableRecommendation({ id: '1', slug: 'deleted', name: 'Deleted', status: 'deleted' })).toBe(false);
  });

  it('uses a truthful UGX price display and never emits NaN or undefined', () => {
    expect(formatRecommendationPrice(125000)).toBe('USh 125,000');
    expect(formatRecommendationPrice(Number.NaN)).toBe('Price on request');
    expect(formatRecommendationPrice(undefined)).toBe('Price on request');
    expect(formatRecommendationPrice(0)).toBe('Price on request');
  });

  it('uses truthful availability labels with an unknown fallback', () => {
    expect(recommendationAvailabilityLabel({ kind: 'in_stock', quantity: 2 })).toBe('In stock');
    expect(recommendationAvailabilityLabel({ kind: 'out_of_stock' })).toBe('Out of stock');
    expect(recommendationAvailabilityLabel({ kind: 'pre_order' })).toBe('Pre-order');
    expect(recommendationAvailabilityLabel({ kind: 'unknown' })).toBe('Confirm availability');
    expect(recommendationAvailabilityLabel(undefined)).toBe('Confirm availability');
  });

  it('creates a safe PDP href, useful image alt and missing-image fallback', () => {
    const normalized = normalizeRecommendationCandidate({ id: '1', slug: 'safe-product', name: 'Safe product' });
    expect(normalized.href).toBe('/products/safe-product');
    expect(normalized.imageAlt).toBe('Safe product product image');
    expect(normalized.imageUrl).toBeUndefined();
  });

  it('allows root-relative and HTTPS images but suppresses unsafe protocols', () => {
    expect(normalizeRecommendationCandidate({ id: '1', slug: 'one', name: 'One', imageUrl: '/one.webp' }).imageUrl).toBe('/one.webp');
    expect(normalizeRecommendationCandidate({ id: '2', slug: 'two', name: 'Two', imageUrl: 'https://images.test/two.webp' }).imageUrl).toBe('https://images.test/two.webp');
    expect(normalizeRecommendationCandidate({ id: '3', slug: 'three', name: 'Three', imageUrl: 'javascript:alert(1)' }).imageUrl).toBeUndefined();
  });

  it('dedupes by product ID while preserving the first eligible candidate', () => {
    const result = dedupeRecommendations([candidate('a', 'first'), candidate('a', 'second')]);
    expect(result.map((item) => item.slug)).toEqual(['first']);
  });

  it('dedupes by slug even when product IDs differ', () => {
    const result = dedupeRecommendations([candidate('a', 'same'), candidate('b', 'same')]);
    expect(result.map((item) => item.id)).toEqual(['a']);
  });

  it('excludes the current product by ID and reports the count', () => {
    const result = previewRecommendationRules([candidate('current', 'current'), candidate('a', 'a')], {
      currentProductId: 'current',
    });
    expect(result.currentProductExcluded).toBe(true);
    expect(result.currentProductExcludedCount).toBe(1);
    expect(result.selected.map((item) => item.id)).toEqual(['a']);
  });

  it('excludes the current product by slug independently of ID', () => {
    const result = previewRecommendationRules([candidate('new-id', 'current'), candidate('a', 'a')], {
      currentProductSlug: 'current',
    });
    expect(result.currentProductExcludedCount).toBe(1);
    expect(result.selected.map((item) => item.id)).toEqual(['a']);
  });

  it('excludes explicit product IDs such as products already in a cart', () => {
    const result = previewRecommendationRules([candidate('cart', 'cart'), candidate('a', 'a')], {
      excludeIds: ['cart'],
    });
    expect(result.selected.map((item) => item.id)).toEqual(['a']);
  });

  it('keeps deterministic input order and enforces the requested maximum', () => {
    const values = [candidate('1', 'one'), candidate('2', 'two'), candidate('3', 'three')];
    expect(previewRecommendationRules(values, { maxCount: 2, categoryDominanceCap: 2 }).selected.map((item) => item.id)).toEqual(['1', '2']);
  });

  it('selects same_subcategory when enough safe candidates support it', () => {
    const result = previewRecommendationRules([
      candidate('1', 'one', 'Power Devices', 'chargers'),
      candidate('2', 'two', 'Power Devices', 'chargers'),
      candidate('3', 'three', 'Sound Devices', 'earbuds'),
    ], { currentCategory: 'Power Devices', currentSubcategory: 'chargers', maxCount: 2 });
    expect(result.selectedRule).toBe('same_subcategory');
    expect(result.selected.map((item) => item.id)).toEqual(['1', '2']);
  });

  it('falls back from a thin subcategory to the supported same_category rule', () => {
    const result = previewRecommendationRules([
      candidate('1', 'one', 'Power Devices', 'chargers'),
      candidate('2', 'two', 'Power Devices', 'power-banks'),
    ], { currentCategory: 'Power Devices', currentSubcategory: 'chargers', maxCount: 2 });
    expect(result.selectedRule).toBe('same_category');
  });

  it('selects complementary_category only from an explicit reviewed relation', () => {
    const result = previewRecommendationRules([
      candidate('sound', 'sound', 'Sound Devices', 'earbuds'),
      candidate('power', 'power', 'Power Devices', 'chargers'),
    ], {
      currentCategory: 'Car Accessories',
      currentSubcategory: 'mounts',
      complementarySubcategories: ['chargers'],
      preferredRule: 'complementary_category',
      maxCount: 1,
    });
    expect(result.selectedRule).toBe('complementary_category');
    expect(result.selected[0]?.id).toBe('power');
  });

  it('does not infer complementary relationships without explicit data', () => {
    const result = previewRecommendationRules([
      candidate('sound', 'sound', 'Sound Devices', 'earbuds'),
      candidate('power', 'power', 'Power Devices', 'chargers'),
    ], { currentCategory: 'Car Accessories', maxCount: 1 });
    expect(result.selectedRule).toBe('catalogue_fallback');
    expect(result.selected[0]?.id).toBe('sound');
  });

  it('uses same_brand_or_family only when both sides provide matching data', () => {
    const result = previewRecommendationRules([
      { ...candidate('one', 'one', 'Storage Devices'), brand: 'GoldPlus Core' },
      { ...candidate('two', 'two', 'Storage Devices'), brand: 'Other' },
    ], { currentBrandOrFamily: 'GoldPlus Core', maxCount: 1 });
    expect(result.selectedRule).toBe('same_brand_or_family');
    expect(result.selected[0]?.id).toBe('one');
  });

  it('uses catalogue_fallback with a clear reason when context has no supported match', () => {
    const result = previewRecommendationRules([candidate('one', 'one', 'Sound Devices')], {
      currentCategory: 'Storage Devices',
    });
    expect(result.selectedRule).toBe('catalogue_fallback');
    expect(result.fallbackUsed).toBe(true);
    expect(result.fallbackReason).toContain('No stronger supported relationship');
  });

  it('uses eligible_candidates in input order when no product context exists', () => {
    const result = previewRecommendationRules([candidate('one', 'one'), candidate('two', 'two')]);
    expect(result.selectedRule).toBe('eligible_candidates');
    expect(result.selected.map((item) => item.id)).toEqual(['one', 'two']);
    expect(result.fallbackReason).toContain('No product context');
  });

  it('returns an honest empty state and auditable before/after counts', () => {
    const result = previewRecommendationRules([{ id: 'bad', slug: '../bad', name: 'Bad' }]);
    expect(result).toMatchObject({ beforeCount: 1, afterCount: 0, ineligibleCount: 1, selectedRule: 'empty' });
    expect(result.emptyReason).toBe('No eligible products are currently available to show.');
  });

  it('applies a category dominance cap and preserves category diversity', () => {
    const result = previewRecommendationRules([
      candidate('1', 'one', 'Power Devices'),
      candidate('2', 'two', 'Power Devices'),
      candidate('3', 'three', 'Power Devices'),
      candidate('4', 'four', 'Sound Devices'),
      candidate('5', 'five', 'Storage Devices'),
    ], { currentCategory: 'Power Devices', maxCount: 4, categoryDominanceCap: 2 });
    expect(result.selected.map((item) => item.id)).toEqual(['1', '2', '4', '5']);
    expect(result.categoryCapApplied).toBe(true);
  });

  it('relaxes the category cap deterministically to fill a sparse catalogue and records why', () => {
    const result = previewRecommendationRules([
      candidate('1', 'one'), candidate('2', 'two'), candidate('3', 'three'),
    ], { maxCount: 3, categoryDominanceCap: 1 });
    expect(result.selected.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(result.sparseCatalogueFill).toBe(true);
    expect(result.sparseCatalogueFillReason).toContain('category cap was relaxed');
  });

  it('records when the eligible catalogue is smaller than the requested maximum', () => {
    const result = previewRecommendationRules([candidate('1', 'one')], { maxCount: 4 });
    expect(result.sparseCatalogueFill).toBe(false);
    expect(result.sparseCatalogueFillReason).toContain('fewer products');
  });

  it('emits explanation text and reason codes only from supported product data', () => {
    const result = previewRecommendationRules([
      candidate('1', 'one', 'Power Devices', 'chargers'),
      candidate('2', 'two', 'Power Devices', 'chargers'),
    ], { currentCategory: 'Power Devices', currentSubcategory: 'chargers', maxCount: 2 });
    expect(result.selectedDetails[0]).toMatchObject({ rule: 'same_subcategory', explanation: 'Shown from the same product family.' });
    expect(result.selected[0]?.reasonCode).toBe('SAME_SUBCATEGORY');
    expect(supportedRecommendationReason(result.selected[0]?.reasonCode)).toBe('Same product family');
  });

  it('contains only explicit reviewed complementary subcategory pairs', () => {
    expect(REVIEWED_COMPLEMENTARY_SUBCATEGORIES['power-banks']).toEqual(['chargers']);
    expect(REVIEWED_COMPLEMENTARY_SUBCATEGORIES.mounts).toEqual(['car-chargers']);
    expect(REVIEWED_COMPLEMENTARY_SUBCATEGORIES).not.toHaveProperty('phones');
  });

  it('maps public products with safe truth fallbacks and derived subcategory data', () => {
    const mapped = productToRecommendationItem(product('1', 'usb-fast-charger', 'Power Devices', 'USB Fast Charger'), 'CATALOGUE_FALLBACK');
    expect(mapped).toMatchObject({ price: undefined, availability: { kind: 'unknown' }, subcategoryName: 'chargers' });
    expect(mapped.imageAlt).toBe('USB Fast Charger product image');
  });

  it('renders truthful price, availability, image and accessible PDP-link fallbacks', () => {
    expect(card).toContain('Price on request');
    expect(card).toContain('Confirm availability');
    expect(card).toContain('Image unavailable');
    expect(card).toContain('aria-label=');
    expect(card).not.toContain('Coming Soon');
  });

  it('uses only the approved honest public rail labels', () => {
    const publicRails = `${relatedRail}\n${completeRail}\n${popularRail}\n${categoryRail}\n${pdp}`;
    expect(publicRails).toContain('Similar products');
    expect(publicRails).toContain('You may also need');
    expect(publicRails).toContain('More from this category');
    expect(publicRails).toContain('Browse available products');
    expect(publicRails).not.toMatch(/You May Also Like|Recommended for you|Customers also bought|Frequently bought together|Best sellers|Most loved|Top rated/);
  });

  it('renders an honest rail empty state with a shop fallback', () => {
    expect(recommendationRail).toContain('No eligible products are currently available to show.');
    expect(recommendationRail).toContain('Browse the shop');
    expect(relatedRail).toContain('No similar products are currently listed.');
  });

  it('keeps recently viewed rendering honest and sanitises its dynamic boundary', () => {
    expect(recentlyViewedRail).toContain('Image unavailable');
    expect(recentlyViewedRail).toContain('Confirm availability');
    expect(recentlyViewedRail).toContain('escapeHtml');
    expect(recentlyViewedRail).toContain('safeSlug');
    expect(recentlyViewedRail).not.toContain('Coming Soon');
  });

  it('shows a read-only operator preview with before/after and integrity outcomes', () => {
    expect(previewPanel).toContain('Storefront integrity preview');
    expect(previewPanel).toContain('Candidates before');
    expect(previewPanel).toContain('Products after');
    expect(previewPanel).toContain('Current product excluded');
    expect(previewPanel).toContain('Duplicates removed');
    expect(previewPanel).toContain('Fallback reason');
    expect(previewPanel).toContain('Empty reason');
    expect(previewPanel).toContain('Read-only preview.');
  });

  it('does not expose mutation controls or customer-data claims in the operator preview', () => {
    expect(previewPanel).toContain('No customer data is used.');
    expect(previewPanel).toContain('No rule changes are saved here.');
    expect(previewPanel).not.toMatch(/Save rule|Activate provider|Delete product/);
    expect(previewPage).toContain('Read-only simulation');
  });
});
