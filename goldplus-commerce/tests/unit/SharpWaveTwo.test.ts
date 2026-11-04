import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HERO_SLIDE_LIBRARY, DEFAULT_HOMEPAGE_CONTENT } from '@goldplus/shared';
import { BUYING_SITUATIONS, situationBySlug } from '../../apps/web/src/lib/buyingSituations';
import { STATIC_SITEMAP_PATHS } from '../../apps/web/src/lib/sitemap';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

describe('Sharp wave 2: situations, upcountry, receipt, loyalty weight', () => {
  it('each buying situation has rows, a unique slug, a sitemap entry and a footer or page link', () => {
    const slugs = BUYING_SITUATIONS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of BUYING_SITUATIONS) {
      expect(s.rows.length).toBeGreaterThan(0);
      expect(s.metaTitle).toMatch(/GoldPlus$/);
      expect(STATIC_SITEMAP_PATHS).toContain(`/for/${s.slug}`);
      for (const g of s.guides) expect(g.href).toMatch(/^\/blog\/[a-z0-9-]+$/);
    }
    expect(situationBySlug('nope')).toBeNull();
    expect(read('apps/web/src/pages/for/[situation].astro')).toContain("Astro.redirect('/404', 404)");
  });
  it('upcountry page exists, is in the sitemap and the footer', () => {
    expect(read('apps/web/src/pages/delivery/upcountry.astro')).toContain('data-upcountry-page');
    expect(STATIC_SITEMAP_PATHS).toContain('/delivery/upcountry');
    expect(DEFAULT_HOMEPAGE_CONTENT.footer.columns.flatMap((c) => c.links.map((l) => l.href))).toContain('/delivery/upcountry');
  });
  it('receipt carries the logo; invite and referral share use the brand line', () => {
    expect(read('apps/web/src/pages/receipt.astro')).toContain('data-receipt-logo');
    expect(read('apps/web/src/pages/invite.astro')).not.toContain('Genuine batteries');
    expect(read('apps/web/src/components/ReferralCard.astro')).toContain('their own line made for Africa');
  });
  it('loyalty is not in the first three hero slides and PDP points show to signed-in shoppers', () => {
    const firstThree = [...HERO_SLIDE_LIBRARY].filter((s) => s.enabled).sort((a, b) => a.position - b.position).slice(0, 3);
    expect(firstThree.some((s) => s.theme === 'loyalty' || s.theme === 'offer')).toBe(false);
    const positions = HERO_SLIDE_LIBRARY.map((s) => s.position);
    expect(new Set(positions).size).toBe(positions.length);
    expect(read('apps/web/src/pages/products/[slug].astro')).toContain('{pdpSignedIn && loyaltyRate > 0');
  });
  it('brand footer links render even when the saved footer predates them, without duplicates', () => {
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toContain('data-brand-footer-links');
    expect(layout).toContain('.filter((l) => !footerHrefs.has(l.href))');
    for (const href of ['/about', '/for/gifts', '/delivery/upcountry']) expect(layout).toContain(`href: '${href}'`);
  });
});
