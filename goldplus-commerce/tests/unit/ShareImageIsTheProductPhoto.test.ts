import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const web = (p: string) => readFileSync(join(__dirname, '..', '..', 'apps', 'web', 'src', p), 'utf8');

/**
 * A product shared on WhatsApp/Facebook/X must show its photo, not the site
 * icon. Two things went wrong before 2026-09-01: the product page never passed
 * its photo to the layout, and og:image was a relative path, which share-card
 * crawlers ignore. Both are pinned here.
 */
describe('share image is the product photo', () => {
  it('the layout emits an absolute og:image and twitter:image', () => {
    const layout = web('layouts/BaseLayout.astro');
    expect(layout).toMatch(/const shareImage = .*SITE_ORIGIN/);
    expect(layout).toContain('<meta property="og:image" content={shareImage} />');
    expect(layout).toContain('<meta property="twitter:image" content={shareImage} />');
  });

  it('the product page passes its primary photo to the layout', () => {
    expect(web('pages/products/[slug].astro')).toMatch(/<BaseLayout[^>]*image=\{product\?\.primaryImageUrl \?\? undefined\}/);
  });

  it('structured data carries absolute image URLs', () => {
    const jsonLd = web('components/ProductJsonLd.astro');
    expect(jsonLd).toContain("import { SITE_ORIGIN } from '../lib/sitemap';");
    expect(jsonLd).toMatch(/node\.image = .*SITE_ORIGIN/);
    expect(web('pages/blog/[slug].astro')).toMatch(/image: \[.*SITE_ORIGIN.*post\.coverImageUrl/);
  });
});
