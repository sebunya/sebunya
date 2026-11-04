import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BRAND_LINE, brandTitle, readBrandIntent, stripBrandPrefix, HERO_SLIDE_LIBRARY, DEFAULT_HOMEPAGE_CONTENT } from '@goldplus/shared';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('Sharp wave 1: distinctive assets and category entry points', () => {
  it('brand helpers name the brand once and read brand intent', () => {
    expect(brandTitle('Flash drive 32GB')).toBe('Flash drive 32GB | GoldPlus');
    expect(brandTitle('GoldPlus GP-C03 | UGX 45,000 in Kampala, Uganda')).not.toMatch(/GoldPlus.*GoldPlus/);
    expect(stripBrandPrefix('GoldPlus GP-C03 Charger')).toBe('GP-C03 Charger');
    expect(readBrandIntent('goldplus charger')).toEqual({ matchSearch: 'charger', ownBrand: true, competitor: null });
    expect(readBrandIntent('gold plus power bank').matchSearch).toBe('power bank');
    expect(readBrandIntent('oraimo charger')).toEqual({ matchSearch: 'charger', ownBrand: false, competitor: 'oraimo' });
    expect(readBrandIntent('type c cable').competitor).toBeNull();
  });
  it('one brand line is read by layout, home, about and manifest', () => {
    expect(read('apps/web/src/layouts/BaseLayout.astro')).toContain('data-brand-line>{BRAND_LINE}');
    expect(read('apps/web/src/layouts/BaseLayout.astro')).toContain('data-footer-wordmark');
    expect(read('apps/web/src/pages/index.astro')).toContain('data-category-strip');
    expect(read('apps/web/src/pages/about.astro')).toContain('{BRAND_LINE}');
    expect(JSON.parse(read('apps/web/public/manifest.json')).description).toBe(BRAND_LINE);
    expect(JSON.parse(read('apps/web/public/manifest.json')).name).toBe('GoldPlus');
    expect(DEFAULT_HOMEPAGE_CONTENT.footer.columns.some((c) => c.links.some((l) => l.href === '/about'))).toBe(true);
  });
  it('hero defaults lead with the range, and the sale slide is no longer first', () => {
    const first = [...HERO_SLIDE_LIBRARY].filter((s) => s.enabled).sort((a, b) => a.position - b.position)[0];
    expect(first.slideKey).toBe('range');
    expect(HERO_SLIDE_LIBRARY.find((s) => s.slideKey === 'flash')?.position).toBeGreaterThan(1);
  });
  it('shop matches on the query with brand words removed and answers competitor searches', () => {
    const shop = read('apps/web/src/pages/shop.astro');
    expect(shop).toContain("searchDiscoveryProducts(availableProducts, { search: matchSearch, category, subcategory }, taxonomy)");
    expect(shop).toContain('data-competitor-route');
  });
  it('emails carry the brand eyebrow', () => {
    expect(read('apps/api/src/infrastructure/notifications/email/generatedEmailTemplates.ts')).not.toContain('PHONE &amp; TECH ACCESSORIES');
  });
});
