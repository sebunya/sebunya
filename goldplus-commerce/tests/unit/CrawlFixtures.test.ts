import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProductPublicDto } from '@goldplus/shared';
import { STATIC_SITEMAP_PATHS, SITE_ORIGIN, isIndexablePath, sitemapIndexXml, urlsetXml } from '../../apps/web/src/lib/sitemap';
import { shopCrawlDirective } from '../../apps/web/src/lib/crawlPolicy';
import { indexableHubForCategory } from '../../apps/web/src/lib/categoryHubs';
import { TOOLS } from '../../apps/web/src/lib/agentTools';
import { situationBySlug } from '../../apps/web/src/lib/buyingSituations';

/**
 * Brief WP4/WP5 (2026-11-05): small, fixture-only guards. No network, no crawler.
 *  - the sitemap XML is well formed: one <loc> per URL, absolute https on the one host, no duplicates, no trailing slash;
 *  - the priority landing pages stay in the static sitemap (and /charger-finder, which d30040b4 meant to list);
 *  - a canonical is absolute, on SITE_ORIGIN, and never names a hub that is noindex;
 *  - the five MCP tools keep their names and public input schemas.
 */

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);

describe('static sitemap is well formed and complete', () => {
  const xml = urlsetXml(STATIC_SITEMAP_PATHS.filter(isIndexablePath).map((loc) => ({ loc })));

  it('is one urlset with a <loc> per <url>, absolute https URLs on the canonical host, unique, no trailing slash', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml.match(/<urlset /g)?.length).toBe(1);
    expect(xml).toContain('</urlset>');
    const urls = locs(xml);
    expect(urls.length).toBe((xml.match(/<url>/g) ?? []).length);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) {
      expect(u.startsWith(`${SITE_ORIGIN}/`), u).toBe(true);
      if (u !== `${SITE_ORIGIN}/`) expect(u.endsWith('/'), u).toBe(false);
      expect(u, u).not.toMatch(/[?#\s]/);
    }
  });

  it('keeps the priority landing pages', () => {
    const urls = locs(xml);
    for (const p of ['/', '/shop', '/bulk', '/quote-request', '/dealers/apply', '/about', '/for/gifts', '/for/fast-charging', '/for/travel', '/for/car-charging', '/delivery/upcountry', '/developers', '/charger-finder']) {
      expect(urls, p).toContain(p === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${p}`);
    }
  });

  it('every static path has a page file (a listed URL that 404s is caught here)', () => {
    const pages = join(__dirname, '../../apps/web/src/pages');
    for (const p of STATIC_SITEMAP_PATHS) {
      // /for/<slug> is one dynamic page: the slug must be a known buying situation.
      if (p.startsWith('/for/')) { expect(situationBySlug(p.slice(5)), p).toBeTruthy(); continue; }
      const base = p === '/' ? '/index' : p;
      const found = [`${base}.astro`, `${base}/index.astro`].some((f) => { try { readFileSync(join(pages, f)); return true; } catch { return false; } });
      expect(found, p).toBe(true);
    }
  });

  it('the index names the five children, each once', () => {
    const children = ['/sitemaps/static.xml', '/sitemaps/products.xml', '/sitemaps/categories.xml', '/sitemaps/hubs.xml', '/sitemaps/blog.xml'];
    const idx = sitemapIndexXml(children);
    expect(locs(idx)).toEqual(children.map((c) => `${SITE_ORIGIN}${c}`));
  });
});

describe('canonicals', () => {
  it('a shop view canonical is absolute on the canonical host and drops sort', () => {
    const { canonicalUrl } = shopCrawlDirective({ params: { category: 'pc-accessories', sort: 'price_asc' }, origin: SITE_ORIGIN });
    expect(canonicalUrl).toBe(`${SITE_ORIGIN}/shop?category=pc-accessories`);
  });

  it('names a hub only while the hub itself is indexable (its release gate passes)', () => {
    // One photographed in-stock charger: no hub reaches the 2-product gate, so every hub page is noindex.
    const thin = [{ id: 'p1', slug: 'x', name: 'Charger', category: 'power-devices', availability: { kind: 'in_stock' }, primaryImageUrl: '/x.jpg' }] as unknown as ProductPublicDto[];
    expect(indexableHubForCategory('pc-accessories', thin)).toBeNull();
    expect(indexableHubForCategory('power-devices', thin)).toBeNull();
    // No catalogue at all (outage): the static mapping stays, as before.
    expect(indexableHubForCategory('pc-accessories', [])).toBe('/computer-accessories');
    expect(indexableHubForCategory('no-such-category', [])).toBeNull();
  });
});

describe('MCP tool contract (five tools, public schemas unchanged)', () => {
  it('keeps the names and input schemas assistants were given', () => {
    const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema]));
    expect(Object.keys(byName)).toEqual(['search_products', 'get_product', 'list_categories', 'find_battery', 'store_info']);
    expect(Object.keys((byName.search_products as any).properties)).toEqual(['query', 'category', 'in_stock_only', 'limit']);
    expect((byName.search_products as any).properties.limit).toMatchObject({ type: 'integer', minimum: 1, maximum: 20, default: 10 });
    expect(Object.keys((byName.get_product as any).properties)).toEqual(['slug', 'url']);
    expect(byName.find_battery).toMatchObject({ required: ['phone_or_code'], properties: { phone_or_code: { type: 'string', minLength: 2, maxLength: 120 } } });
    expect(byName.list_categories).toEqual({ type: 'object', properties: {}, additionalProperties: false });
    expect(byName.store_info).toEqual({ type: 'object', properties: {}, additionalProperties: false });
    for (const s of Object.values(byName)) expect((s as any).additionalProperties).toBe(false);
  });
});
