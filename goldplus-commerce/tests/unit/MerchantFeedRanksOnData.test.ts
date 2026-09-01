import { describe, expect, it } from 'vitest';
import { GOOGLE_CATEGORY, googleProductCategoryFor, productTypeFor } from '../../apps/api/src/domain/advertising/GoogleProductCategory';
import { buildMerchantFeedXml, feedDescription, type FeedProduct } from '../../apps/api/src/application/use-cases/seo-growth/MerchantFeedUseCase';

const base = (over: Partial<FeedProduct> = {}): FeedProduct => ({
  sku: 'GP-C10', slug: 'goldplus-charger-gp-c10', name: 'GoldPlus Charger GP-C10', shortDescription: 'GoldPlus charger, model GP-C10. Every unit is tested before it is sold.',
  priceUgx: 16000, floorPriceUgx: 12000, stockStatus: 'in_stock', imageUrl: '/uploads/assets/79/79398d384ddb/pdp.webp', modelNumber: 'GP-C10',
  isFeedEligible: true, active: true, approvalStatus: 'approved', categoryName: 'Power Devices', subcategory: 'Chargers',
  imageUrls: ['/uploads/assets/79/79398d384ddb/pdp.webp', '/uploads/assets/aa/aaaaaaaaaaaa/pdp.webp'], ...over,
});

describe('Google product taxonomy mapping', () => {
  it('maps every kind in the live catalogue to an existing taxonomy path', () => {
    const cases: Array<[string, string | null]> = [
      ['GoldPlus Battery GP-39LT9', GOOGLE_CATEGORY.batteries],
      ['GoldPlus Cable GP-L01V', GOOGLE_CATEGORY.cables],
      ['GoldPlus Power Bank GP-X03', GOOGLE_CATEGORY.chargers],
      ['GoldPlus Charger GP-C10', GOOGLE_CATEGORY.chargers],
      ['GoldPlus Car Charger GP-CA01', GOOGLE_CATEGORY.chargers],
      ['GoldPlus Bluetooth GP-W04', GOOGLE_CATEGORY.headphones],
      ['GoldPlus Earphones GP-H02', GOOGLE_CATEGORY.headphones],
      ['GoldPlus Memory Card 32GB', GOOGLE_CATEGORY.memoryCards],
      ['GoldPlus Flash Drive 16GB', GOOGLE_CATEGORY.flashDrives],
      ['GoldPlus Mouse MOS-W321R', GOOGLE_CATEGORY.mice],
      ['GoldPlus Sound Card ADT-S005', GOOGLE_CATEGORY.soundCards],
      ['GoldPlus Card Reader CRD-011', GOOGLE_CATEGORY.memoryAccessories],
    ];
    for (const [name, want] of cases) expect(googleProductCategoryFor({ name }), name).toBe(want);
  });

  it('a power bank is a charger, not a battery; an unknown thing gets no category rather than a wrong one', () => {
    expect(googleProductCategoryFor({ name: 'GoldPlus Power Bank Battery 20000mAh' })).toBe(GOOGLE_CATEGORY.chargers);
    expect(googleProductCategoryFor({ name: 'GoldPlus Widget X', categoryName: 'Storage Devices' })).toBeNull();
    expect(productTypeFor({ categoryName: 'Power Devices', subcategory: 'Chargers' })).toBe('Power Devices > Chargers');
    expect(productTypeFor({ categoryName: 'Power Devices', subcategory: null })).toBe('Power Devices');
    expect(productTypeFor({})).toBeNull();
  });
});

describe('the merchant feed carries what Shopping ranks on', () => {
  it('emits category, type, gallery images, and absolute links', () => {
    const xml = buildMerchantFeedXml([base()]);
    expect(xml).toContain('<g:google_product_category>Electronics &gt; Electronics Accessories &gt; Power &gt; Power Adapters &amp; Chargers</g:google_product_category>');
    expect(xml).toContain('<g:product_type>Power Devices &gt; Chargers</g:product_type>');
    expect(xml).toContain('<g:image_link>https://shopgoldplus.com/uploads/assets/79/79398d384ddb/pdp.webp</g:image_link>');
    expect(xml).toContain('<g:additional_image_link>https://shopgoldplus.com/uploads/assets/aa/aaaaaaaaaaaa/pdp.webp</g:additional_image_link>');
    expect(xml).not.toContain('<g:additional_image_link>https://shopgoldplus.com/uploads/assets/79/79398d384ddb/pdp.webp');
    expect(xml).toContain('<g:brand>GoldPlus</g:brand>');
    expect(xml).toContain('<g:mpn>GP-C10</g:mpn>');
    expect(xml).toContain('<g:condition>new</g:condition>');
  });

  it('never invents: no category tag when unsure, no extra images when there are none, at most ten extras', () => {
    const xml = buildMerchantFeedXml([base({ name: 'GoldPlus Widget X', categoryName: null, subcategory: null, imageUrls: undefined })]);
    expect(xml).not.toContain('g:google_product_category');
    expect(xml).not.toContain('g:product_type');
    expect(xml).not.toContain('g:additional_image_link');
    const many = buildMerchantFeedXml([base({ imageUrls: ['/uploads/assets/79/79398d384ddb/pdp.webp', ...Array.from({ length: 14 }, (_, i) => `/x/${i}.webp`)] })]);
    expect((many.match(/g:additional_image_link>/g) ?? []).length / 2).toBe(10);
  });

  it('the long description wins when written; availability knows preorder', () => {
    expect(feedDescription({ shortDescription: 'short', longDescription: '  long text  ' })).toBe('long text');
    expect(feedDescription({ shortDescription: 'short', longDescription: '' })).toBe('short');
    expect(buildMerchantFeedXml([base({ stockStatus: 'pre_order' })])).toContain('<g:availability>preorder</g:availability>');
  });
});
