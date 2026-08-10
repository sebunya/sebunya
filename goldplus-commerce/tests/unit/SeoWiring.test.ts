import { describe, expect, it } from 'vitest';
import {
  STATIC_SITEMAP_PATHS,
  NON_INDEXABLE_PREFIXES,
  isIndexablePath,
  urlsetXml,
  sitemapIndexXml,
  SITE_ORIGIN,
} from '../../apps/web/src/lib/sitemap';
import { evaluateCrawlPolicy as webEvaluateCrawlPolicy, shopCrawlDirective } from '../../apps/web/src/lib/crawlPolicy';
import { evaluateCrawlPolicy as domainEvaluateCrawlPolicy } from '../../apps/api/src/domain/seo/CrawlPolicy';
import { serializeJsonLd, breadcrumbJsonLd } from '../../apps/web/src/lib/jsonld';
import { RecordProductSlugChangeUseCase } from '../../apps/api/src/application/use-cases/products/RecordProductSlugChangeUseCase';

/**
 * U6 — wiring of the previously dead SEO plumbing: sitemap lists, the shop
 * crawl directive, JSON-LD serialization, and slug-change redirect recording.
 */

describe('static sitemap list (U6)', () => {
  it('excludes every noindex page family (cart/checkout/account/admin/auth/compare/track-order)', () => {
    for (const path of STATIC_SITEMAP_PATHS) {
      for (const prefix of NON_INDEXABLE_PREFIXES) {
        expect(path === prefix || path.startsWith(`${prefix}/`), `${path} must not be under ${prefix}`).toBe(false);
      }
      expect(isIndexablePath(path)).toBe(true);
    }
  });

  it('still lists the core indexable pages', () => {
    for (const p of ['/', '/shop', '/verification', '/support', '/loyalty', '/dealers/apply', '/quote-request']) {
      expect(STATIC_SITEMAP_PATHS).toContain(p);
    }
  });

  it('isIndexablePath rejects checkout sub-paths and admin', () => {
    expect(isIndexablePath('/checkout/pesapal/callback')).toBe(false);
    expect(isIndexablePath('/admin/products')).toBe(false);
    expect(isIndexablePath('/products/some-slug')).toBe(true);
  });

  it('urlsetXml emits lastmod only when provided, on the canonical host', () => {
    const xml = urlsetXml([{ loc: '/shop' }, { loc: '/products/x', lastmod: '2026-08-01T00:00:00.000Z' }]);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/shop</loc>`);
    expect(xml).toContain('<lastmod>2026-08-01T00:00:00.000Z</lastmod>');
    // the entry without lastmod must not get one
    expect(xml.split('<lastmod>')).toHaveLength(2);
  });

  it('sitemap index references the three child sitemaps', () => {
    const xml = sitemapIndexXml(['/sitemaps/static.xml', '/sitemaps/products.xml', '/sitemaps/categories.xml']);
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/sitemaps/products.xml</loc>`);
    expect(xml).toContain('<sitemapindex');
  });
});

describe('shop robots directive (U6 AC5, web mirror of the domain rule)', () => {
  it('mirrors the domain evaluateCrawlPolicy verbatim across representative inputs', () => {
    const cases = [
      { params: {}, hasUniqueCopy: undefined },
      { params: { category: 'power' }, hasUniqueCopy: true },
      { params: { category: 'power' }, hasUniqueCopy: false },
      { params: { category: 'power', subcategory: 'chargers' }, hasUniqueCopy: true },
      { params: { sort: 'price_desc' }, hasUniqueCopy: true },
      { params: { category: 'power', page: '2' }, hasUniqueCopy: true },
    ];
    for (const input of cases) {
      const web = webEvaluateCrawlPolicy(input);
      const domain = domainEvaluateCrawlPolicy(input);
      expect(web.robots).toBe(domain.robots);
      expect(web.canonicalParams).toEqual(domain.canonicalParams);
    }
  });

  it('bare /shop stays default-indexable (no robots meta), search results are noindex,follow', () => {
    const bare = shopCrawlDirective({ params: {}, origin: 'https://shopgoldplus.com' });
    expect(bare.robotsMeta).toBeUndefined();
    expect(bare.canonicalUrl).toBe('https://shopgoldplus.com/shop');

    const search = shopCrawlDirective({ params: { search: 'charger' }, hasUniqueCopy: false, origin: 'https://shopgoldplus.com' });
    expect(search.robotsMeta).toBe('noindex,follow');
  });

  it('sort variants are noindex and stripped from the canonical', () => {
    const d = shopCrawlDirective({ params: { category: 'power', sort: 'price_desc' }, hasUniqueCopy: true, origin: 'https://shopgoldplus.com' });
    expect(d.robotsMeta).toBe('noindex,follow');
    expect(d.canonicalUrl).toBe('https://shopgoldplus.com/shop?category=power');
  });
});

describe('web JSON-LD serialization (U6 AC4)', () => {
  it('escapes angle brackets so content cannot break out of the script tag', () => {
    const json = serializeJsonLd(breadcrumbJsonLd([{ name: '</script><b>x', url: 'https://shopgoldplus.com/' }]));
    expect(json).not.toContain('<');
    expect(json).not.toContain('>');
    expect(json).toContain('\\u003c/script\\u003e');
  });

  it('builds an ordered BreadcrumbList', () => {
    const node = breadcrumbJsonLd([
      { name: 'Home', url: 'https://shopgoldplus.com/' },
      { name: 'Power', url: 'https://shopgoldplus.com/shop?category=power' },
      { name: 'Charger X', url: 'https://shopgoldplus.com/products/charger-x' },
    ]);
    expect(node['@type']).toBe('BreadcrumbList');
    expect(node.itemListElement.map((i: any) => i.position)).toEqual([1, 2, 3]);
  });
});

describe('RecordProductSlugChangeUseCase (U6 AC6)', () => {
  const makeFake = () => {
    const calls: Array<{ oldSlug: string; newSlug: string; createdBy: string | null; now: Date }> = [];
    return {
      calls,
      repo: {
        async recordSlugChange(input: { oldSlug: string; newSlug: string; createdBy: string | null; now: Date }) {
          calls.push(input);
          return { fromPath: `/p/${input.oldSlug}`, toPath: `/p/${input.newSlug}` };
        },
      },
    };
  };

  it('records a redirect when the slug actually changed', async () => {
    const { repo, calls } = makeFake();
    const uc = new RecordProductSlugChangeUseCase(repo);
    const result = await uc.execute({ oldSlug: 'old-charger', newSlug: 'new-charger', actorId: 'admin-1' });
    expect(result).toEqual({ fromPath: '/p/old-charger', toPath: '/p/new-charger' });
    expect(calls).toHaveLength(1);
    expect(calls[0].createdBy).toBe('admin-1');
  });

  it('is a no-op when the slug did not change (including case/whitespace-only edits)', async () => {
    const { repo, calls } = makeFake();
    const uc = new RecordProductSlugChangeUseCase(repo);
    expect(await uc.execute({ oldSlug: 'same-slug', newSlug: 'same-slug', actorId: 'admin-1' })).toBeNull();
    expect(await uc.execute({ oldSlug: 'Same-Slug ', newSlug: 'same-slug', actorId: 'admin-1' })).toBeNull();
    expect(await uc.execute({ oldSlug: '', newSlug: 'x', actorId: null })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
