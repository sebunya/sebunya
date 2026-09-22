import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pickDisplayUrl, DISPLAY_RENDITION } from '../../apps/api/src/infrastructure/db/mediaDisplayUrl';

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

/**
 * What the storefront shows is the 1024px webp rendition the media library
 * made at upload, never the original — smaller, modern, and at its own path
 * (the originals of six products were cached by the edge as 404s for a year
 * on 2026-09-01; renditions were never requested and so never poisoned). One
 * resolver, every reader.
 */
describe('the storefront serves renditions', () => {
  it('prefers the recorded rendition and falls back to the original', () => {
    expect(DISPLAY_RENDITION).toEqual({ purpose: 'pdp', format: 'webp' });
    expect(pickDisplayUrl('/uploads/assets/aa/x/orig.jpg', '/uploads/assets/aa/x/pdp.webp')).toBe('/uploads/assets/aa/x/pdp.webp');
    expect(pickDisplayUrl('/uploads/products/p1/legacy.png', null)).toBe('/uploads/products/p1/legacy.png');
    expect(pickDisplayUrl('/uploads/products/p1/legacy.png', '')).toBe('/uploads/products/p1/legacy.png');
  });

  it('every product-image reader resolves through the shared resolver', () => {
    const rows = ['DrizzleProductRepository', 'DrizzleProductRecommendationReader', 'DrizzleBlogRepository'];
    for (const r of rows) {
      const src = read(`apps/api/src/infrastructure/db/repositories/${r}.ts`);
      expect(src, r).toContain("import { displayUrlMap } from '../mediaDisplayUrl';");
      expect(src, r).toMatch(/display\.get\(\w+\.url\) \?\? \w+\.url/);
    }
    for (const r of ['DrizzleBatteryCatalogueRepository', 'DrizzleBatteryFinderRepository', 'DrizzleSeoGrowthRepository']) {
      const src = read(`apps/api/src/infrastructure/db/repositories/${r}.ts`);
      // Focus 4: the rendition resolver AND the one gallery order come from the same module.
      expect(src, r).toContain("import { displayImageUrlSql, galleryOrderSql, galleryVisibleSql } from '../mediaDisplayUrl';");
      expect(src, r).toContain("${displayImageUrlSql('i')}");
      expect(src, r).toContain("${galleryOrderSql('i')}");
    }
    // No reader hands the raw column to a public surface any more.
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleBatteryFinderRepository.ts')).not.toMatch(/SELECT i\.url FROM product_images/);
  });

  it('the merchant feed no longer depends on the legacy products.image_url column alone', () => {
    const feed = read('apps/api/src/infrastructure/db/repositories/DrizzleSeoGrowthRepository.ts');
    // The gallery's rendition first; the legacy column only when there is no gallery image.
    // Focus 4: slot 1 first (galleryOrderSql), legacy rows hidden once migrated (galleryVisibleSql), legacy column last.
    // A sample/placeholder frame (alt "Sample …") never reaches Google; a migrated product with only samples counts as "no image".
    expect(feed).toContain("coalesce((select ${displayImageUrlSql('i')} from product_images i where i.product_id = p.id and ${galleryVisibleSql('i', sql.raw('p.id'))} and coalesce(i.alt_text, '') not like 'Sample %' order by ${galleryOrderSql('i')} limit 1), case when exists (select 1 from product_images s where s.product_id = p.id and s.slot is not null) then null else p.image_url end) as image_url");
    for (const r of ['DrizzleBatteryCatalogueRepository', 'DrizzleBatteryFinderRepository']) {
      const src = read(`apps/api/src/infrastructure/db/repositories/${r}.ts`);
      expect(src, r).toMatch(/COALESCE\(\(SELECT \$\{displayImageUrlSql\('i'\)\}.*LIMIT 1\), \$\{products\.imageUrl\}\)/);
    }
    // Google requires absolute image URLs.
    const feedXml = read('apps/api/src/application/use-cases/seo-growth/MerchantFeedUseCase.ts');
    expect(feedXml).toContain('<g:image_link>${escapeXml(absolute(baseUrl, p.imageUrl!))}</g:image_link>');
    expect(feedXml).toMatch(/const absolute = \(baseUrl: string, url: string\): string =>\s*\/\^https\?:/);
  });
});
