import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexableCategoryHref, withIndexableHrefs } from '../../apps/web/src/lib/indexableLinks';

/**
 * 2026-10-08 SEO audit: 67% of internal links pointed at noindex /shop filter
 * views; the indexable category hubs got 0.3%. Menus, footer, home tiles and
 * product breadcrumbs now link to the hub that covers exactly the same
 * selection, and nothing else changes.
 */
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

describe('indexableCategoryHref', () => {
  it('maps a category (either naming) to its hub', () => {
    expect(indexableCategoryHref('/shop?category=power')).toBe('/power');
    expect(indexableCategoryHref('/shop?category=power-devices')).toBe('/power');
    expect(indexableCategoryHref('/shop?category=sound')).toBe('/audio');
    expect(indexableCategoryHref('/shop?category=storage-devices')).toBe('/storage');
    expect(indexableCategoryHref('/shop?category=car')).toBe('/car-accessories');
    expect(indexableCategoryHref('/shop?category=pc')).toBe('/computer-accessories');
  });

  it('maps a category + term only when a child hub covers exactly that term', () => {
    expect(indexableCategoryHref('/shop?category=power&q=power+bank')).toBe('/power/power-banks');
    expect(indexableCategoryHref('/shop?category=power&q=wall+charger')).toBe('/power/chargers');
    expect(indexableCategoryHref('/shop?category=power&q=cable')).toBe('/power/charging-cables');
    expect(indexableCategoryHref('/shop?category=sound&q=earbuds')).toBe('/audio/wireless-earbuds');
    expect(indexableCategoryHref('/shop?category=storage&q=flash+drive')).toBe('/storage/usb-flash-drives');
    expect(indexableCategoryHref('/shop?category=storage&q=memory+card')).toBe('/storage/memory-cards');
  });

  it('leaves filters, sorting, paging and everything else exactly as they were', () => {
    for (const href of [
      '/shop?category=storage&q=32gb', // capacity filter: no hub
      '/shop?category=power&q=adapter', // adapters are not only chargers
      '/shop?category=sound&q=headphones', // that child hub is not indexable yet
      '/shop?category=car&q=charger',
      '/shop?sort=price-low-high',
      '/shop?category=power&page=2',
      '/battery-finder?q=Tecno',
      '/products/goldplus-charger-gp-c11',
      'https://example.com/shop?category=power',
    ]) expect(indexableCategoryHref(href)).toBe(href);
  });

  it('every target is a hub path that the hub config defines', async () => {
    const { CATEGORY_HUBS, hubPath } = await import('../../apps/web/src/lib/categoryHubs');
    const defined = new Set(CATEGORY_HUBS.flatMap((h: any) => [hubPath(h.slug), ...h.children.map((c: any) => hubPath(h.slug, c.slug))]));
    const src = read('apps/web/src/lib/indexableLinks.ts');
    const targets = [...src.matchAll(/'(\/[a-z-]+(?:\/[a-z-]+)?)'/g)].map((m) => m[1]).filter((t) => t !== '/shop');
    expect(targets.length).toBeGreaterThan(10);
    for (const t of targets) expect(defined.has(t)).toBe(true);
    expect(targets).not.toContain('/audio/headphones');
  });

  it('withIndexableHrefs rewrites nested hrefs without touching other fields', () => {
    const cfg = { label: 'x', cats: [{ href: '/shop?category=power', label: 'Power' }, { href: '/shop?category=storage&q=8gb' }], flash: { cta: { href: '/shop?category=sound' } } };
    expect(withIndexableHrefs(cfg)).toEqual({ label: 'x', cats: [{ href: '/power', label: 'Power' }, { href: '/shop?category=storage&q=8gb' }], flash: { cta: { href: '/audio' } } });
  });

  it('is wired into the menus, footer, home tiles and product breadcrumbs', () => {
    expect(read('apps/web/src/components/GpNav.astro')).toMatch(/withIndexableHrefs\(await getNavConfig\(\)\)/);
    expect(read('apps/web/src/layouts/BaseLayout.astro')).toMatch(/href=\{indexableCategoryHref\(l\.href\)\}/);
    expect(read('apps/web/src/pages/index.astro')).toMatch(/indexableCategoryHref\(`\/shop\?category=\$\{cat\.slug\}`\)/);
    const pdp = read('apps/web/src/pages/products/[slug].astro');
    expect((pdp.match(/indexableCategoryHref\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
