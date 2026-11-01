import { describe, expect, it } from 'vitest';

import {
  buildMerchantFeedXml, isFeedIncluded, escapeXml, FeedQualityUseCase,
  type FeedProduct,
} from '../../apps/api/src/application/use-cases/seo-growth/MerchantFeedUseCase';

/**
 * The admin page reported "Syndication Layer Halted" while this generator was
 * already producing a live Merchant Center feed. These tests pin the behaviour
 * the console now surfaces, so a defective product cannot quietly take the
 * whole feed down with it.
 */

const product = (over: Partial<FeedProduct> = {}): FeedProduct => ({
  sku: 'GP-PB-001',
  slug: 'goldplus-power-bank',
  name: 'GoldPlus 20000mAh Power Bank',
  shortDescription: 'A dependable 20000mAh power bank with fast charging and dual output ports for everyday use.',
  priceUgx: 185_000,
  stockStatus: 'in_stock',
  imageUrl: 'https://shopgoldplus.com/img/pb-001.jpg',
  modelNumber: 'GP-P07',
  isFeedEligible: true,
  active: true,
  approvalStatus: 'approved',
  ...over,
} as FeedProduct);

describe('a product enters the feed only when it is genuinely sellable', () => {
  it('includes a complete, active, approved, priced product with an image', () => {
    expect(isFeedIncluded(product())).toBe(true);
  });

  it('excludes a product not marked feed-eligible', () => {
    expect(isFeedIncluded(product({ isFeedEligible: false }))).toBe(false);
  });

  it('excludes an inactive product', () => {
    expect(isFeedIncluded(product({ active: false }))).toBe(false);
  });

  it('excludes an unapproved product', () => {
    expect(isFeedIncluded(product({ approvalStatus: 'pending' }))).toBe(false);
  });

  it('excludes a product with no image', () => {
    expect(isFeedIncluded(product({ imageUrl: null }))).toBe(false);
    expect(isFeedIncluded(product({ imageUrl: '   ' }))).toBe(false);
  });

  it('excludes a product with no price', () => {
    expect(isFeedIncluded(product({ priceUgx: 0 }))).toBe(false);
    // A negative price is not a discount; it is bad data.
    expect(isFeedIncluded(product({ priceUgx: -1 }))).toBe(false);
  });
});

describe('one defective product does not destroy the feed', () => {
  const good = product();
  const bad = product({ sku: 'GP-BAD-001', slug: 'broken', priceUgx: 0, imageUrl: null });

  it('emits the valid product and omits the invalid one', () => {
    const xml = buildMerchantFeedXml([good, bad]);
    expect(xml).toContain('GP-PB-001');
    expect(xml).not.toContain('GP-BAD-001');
  });

  it('still produces a well-formed document', () => {
    const xml = buildMerchantFeedXml([good, bad]);
    expect(xml.trimStart()).toMatch(/^<\?xml/);
    expect(xml).toContain('</rss>');
    // Balanced item elements.
    expect((xml.match(/<item>/g) ?? []).length).toBe((xml.match(/<\/item>/g) ?? []).length);
  });

  it('produces a valid empty feed when nothing qualifies', () => {
    const xml = buildMerchantFeedXml([bad]);
    expect(xml).toContain('</rss>');
    expect((xml.match(/<item>/g) ?? []).length).toBe(0);
  });

  it('produces a valid document from an empty catalogue', () => {
    const xml = buildMerchantFeedXml([]);
    expect(xml.trimStart()).toMatch(/^<\?xml/);
    expect((xml.match(/<item>/g) ?? []).length).toBe(0);
  });
});

describe('serialisation is safe', () => {
  it('escapes characters that would otherwise break the XML', () => {
    expect(escapeXml('Fast & Bright <Power> "X"')).not.toContain('<Power>');
    expect(escapeXml('a & b')).toContain('&amp;');
  });

  it('escapes a product name containing markup', () => {
    const xml = buildMerchantFeedXml([product({ name: 'Power Bank <b>PRO</b> & More' })]);
    expect(xml).not.toContain('<b>PRO</b>');
    expect(xml).toContain('&amp;');
  });

  it('emits one item per included product', () => {
    const xml = buildMerchantFeedXml([
      product({ sku: 'A', slug: 'a' }),
      product({ sku: 'B', slug: 'b' }),
    ]);
    expect((xml.match(/<item>/g) ?? []).length).toBe(2);
  });

  it('builds a canonical product URL from the slug', () => {
    const xml = buildMerchantFeedXml([product({ slug: 'goldplus-power-bank' })]);
    expect(xml).toContain('/products/goldplus-power-bank');
  });

  it('is deterministic across repeated generation', () => {
    const rows = [product({ sku: 'A', slug: 'a' }), product({ sku: 'B', slug: 'b' })];
    expect(buildMerchantFeedXml(rows)).toBe(buildMerchantFeedXml(rows));
  });
});

describe('identifiers are never invented', () => {
  it('omits MPN entirely when no model number exists', () => {
    const xml = buildMerchantFeedXml([product({ modelNumber: null })]);
    expect(xml).not.toContain('<g:mpn>');
  });

  it('emits MPN when a real model number exists', () => {
    expect(buildMerchantFeedXml([product({ modelNumber: 'GP-P07' })])).toContain('GP-P07');
  });

  it('never emits a GTIN, because GoldPlus does not hold one', () => {
    // Fabricating a GTIN would be a false product identifier in a public feed.
    expect(buildMerchantFeedXml([product()])).not.toContain('<g:gtin>');
  });
});

describe('the quality report explains every inclusion decision', () => {
  const run = (rows: FeedProduct[]) => new FeedQualityUseCase(async () => rows).execute();

  it('counts included and excluded so they sum to the catalogue', async () => {
    const r = await run([product({ sku: 'A' }), product({ sku: 'B', active: false })]);
    expect(r.totalProducts).toBe(2);
    expect(r.includedInFeed + r.excludedFromFeed).toBe(r.totalProducts);
  });

  it('names the reason a product was excluded', async () => {
    const r = await run([product({ sku: 'X', imageUrl: null })]);
    expect(r.products[0].included).toBe(false);
    expect(r.products[0].issues).toContain('missing_image');
  });

  it('separates quality warnings from blocking exclusions', async () => {
    // A short description is a warning; the product still ships in the feed.
    const r = await run([product({ shortDescription: 'Short.' })]);
    expect(r.products[0].included).toBe(true);
    expect(r.products[0].issues).toContain('description_under_50_chars');
  });

  it('flags an over-long title without excluding the product', async () => {
    const r = await run([product({ name: 'x'.repeat(151) })]);
    expect(r.products[0].included).toBe(true);
    expect(r.products[0].issues).toContain('title_over_150_chars');
  });

  it('aggregates issue counts across the catalogue', async () => {
    const r = await run([product({ sku: 'A', imageUrl: null }), product({ sku: 'B', imageUrl: null })]);
    expect(r.issueCounts.missing_image).toBe(2);
  });

  it('reports a clean catalogue as fully included', async () => {
    const r = await run([product({ sku: 'A' }), product({ sku: 'B', slug: 'b' })]);
    expect(r.excludedFromFeed).toBe(0);
    expect(r.includedInFeed).toBe(2);
  });

  it('handles an empty catalogue without inventing counts', async () => {
    const r = await run([]);
    expect(r.totalProducts).toBe(0);
    expect(r.includedInFeed).toBe(0);
    expect(r.excludedFromFeed).toBe(0);
  });

  it('is idempotent across repeated runs', async () => {
    const rows = [product({ sku: 'A' }), product({ sku: 'B', slug: 'b', priceUgx: 0 })];
    expect(await run(rows)).toEqual(await run(rows));
  });
});
