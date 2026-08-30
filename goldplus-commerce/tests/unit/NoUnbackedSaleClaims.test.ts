import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md forbids invented scarcity. Every sale claim on the storefront must
 * be backed by something real, and a link that promises a sale must lead to
 * one. The footer advertised "Flash sale" on EVERY page, linking to
 * /shop?promo=flash-sale — a parameter no page reads — so the customer landed
 * on the ordinary full catalogue while flash_sale_items held zero rows.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('the storefront does not advertise a sale it does not have', () => {
  it('no page links to a flash sale', () => {
    for (const f of ['apps/web/src/layouts/BaseLayout.astro', 'apps/web/src/components/GpNav.astro']) {
      expect(read(f), f).not.toMatch(/promo=flash-sale/);
    }
  });

  it('the promo parameter is still read by nobody, so no link may imply it filters', () => {
    // If a real promo filter is ever built, this test should be replaced by one
    // asserting the filter works — not deleted to re-allow the dead link.
    expect(read('apps/web/src/pages/shop.astro')).not.toMatch(/searchParams\.get\('promo'\)/);
  });

  it('the blog is reachable from the site, not only from the sitemap', () => {
    // An orphaned page is one no customer can find and one search engines
    // discount: /blog was reachable only by typing the URL or reading the XML.
    expect(read('apps/web/src/layouts/BaseLayout.astro')).toContain('href="/blog"');
  });

  it('the footer still offers the real ways to browse', () => {
    const footer = read('apps/web/src/layouts/BaseLayout.astro');
    for (const href of ['/shop?category=power', '/shop?category=sound', '/shop?category=storage', '/shop?category=car', '/shop?category=pc', '/product-finder']) {
      expect(footer, href).toContain(href);
    }
  });
});
