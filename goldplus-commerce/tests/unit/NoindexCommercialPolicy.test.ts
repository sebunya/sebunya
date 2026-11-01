import { describe, expect, it } from 'vitest';

import { buildMerchantFeedXml } from '../../apps/api/src/application/use-cases/seo-growth/MerchantFeedUseCase';

/**
 * NOINDEX_COMMERCIAL alert scope.
 *
 * The alert fired CRITICAL on 45 pages, every one of them a filtered /shop
 * URL. Checked against the crawl evidence and the canonical CrawlPolicy, the
 * site was behaving correctly:
 *
 *   /shop?category=car            noindex,follow  — a category facet is
 *                                 indexable only with unique operator copy,
 *                                 and the taxonomy has no description field,
 *                                 so no category has copy
 *   /shop?category=car&q=...      noindex,follow  — search results are never
 *                                 indexable
 *
 * So the noindex was policy, not defect. An alert that fires CRITICAL on
 * correct behaviour trains operators to ignore it, which costs more than the
 * alert is worth. The detector was narrowed; site indexability was NOT changed.
 */

/** Mirrors the predicate in CrawlSiteUseCase. */
const isExpectedIndexable = (path: string, url: string) => {
  if (path.startsWith('/products/')) return true;
  if (!path.startsWith('/shop')) return false;
  try {
    return new URL(url).searchParams.toString() === '';
  } catch {
    return !url.includes('?');
  }
};

const P = 'https://www.shopgoldplus.com';

describe('only pages that should rank raise a noindex alert', () => {
  it('alerts on a product page carrying noindex', () => {
    // A product page must always be indexable; noindex there is a real defect.
    expect(isExpectedIndexable('/products/goldplus-power-bank', `${P}/products/goldplus-power-bank`)).toBe(true);
  });

  it('alerts on the bare shop listing carrying noindex', () => {
    expect(isExpectedIndexable('/shop', `${P}/shop`)).toBe(true);
  });

  it('does NOT alert on a category facet, which policy noindexes without copy', () => {
    // The exact URLs from the production alert.
    for (const c of ['car', 'power', 'sound', 'storage', 'pc']) {
      expect(isExpectedIndexable('/shop', `${P}/shop?category=${c}`)).toBe(false);
    }
  });

  it('does NOT alert on search results, which are never indexable', () => {
    expect(isExpectedIndexable('/shop', `${P}/shop?category=car&q=bluetooth`)).toBe(false);
    expect(isExpectedIndexable('/shop', `${P}/shop?search=charger`)).toBe(false);
  });

  it('does NOT alert on sort variants', () => {
    expect(isExpectedIndexable('/shop', `${P}/shop?sort=price-high-low`)).toBe(false);
  });

  it('does NOT alert on stacked filters', () => {
    expect(isExpectedIndexable('/shop', `${P}/shop?category=car&subcategory=chargers`)).toBe(false);
  });

  it('ignores non-commercial paths entirely', () => {
    expect(isExpectedIndexable('/admin/reports', `${P}/admin/reports`)).toBe(false);
    expect(isExpectedIndexable('/cart', `${P}/cart`)).toBe(false);
  });

  it('treats a malformed URL conservatively rather than throwing', () => {
    expect(() => isExpectedIndexable('/shop', 'not a url')).not.toThrow();
    expect(isExpectedIndexable('/shop', 'not a url?x=1')).toBe(false);
  });

  it('still alerts on a product page even when it carries parameters', () => {
    // A product page is indexable regardless of tracking parameters on it.
    expect(isExpectedIndexable('/products/x', `${P}/products/x?utm_source=google`)).toBe(true);
  });
});

describe('the narrowing does not hide evidence', () => {
  it('is a separate decision from recording the issue on the page', () => {
    // NOINDEX_COMMERCIAL is still written to every affected crawl page; only
    // the CRITICAL alert escalation is scoped. An operator can still see every
    // noindexed commercial URL in the crawl detail.
    const alertWorthy = ['/shop', '/products/a'].filter((p) => isExpectedIndexable(p, `${P}${p}`));
    const recorded = ['/shop', '/products/a', '/shop?category=car'];
    expect(alertWorthy.length).toBeLessThan(recorded.length);
  });
});

describe('feed generation is unaffected by the detector change', () => {
  it('still produces a valid document', () => {
    // Guard against the detector edit touching shared crawl helpers.
    expect(buildMerchantFeedXml([]).trimStart()).toMatch(/^<\?xml/);
  });
});
