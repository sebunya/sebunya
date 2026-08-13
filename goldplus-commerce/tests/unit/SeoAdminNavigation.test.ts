import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_NAVIGATION, ADMIN_NAVIGATION_ITEMS } from '../../apps/web/src/lib/admin-navigation';

/**
 * Light contract for the Organic Growth OS (Search Growth) navigation:
 * the entries exist, live in one group, and each href maps to a real page file.
 * (Full href resolution across the app is the architecture test's job.)
 */

const EXPECTED: Array<{ label: string; href: string }> = [
  { label: 'SEO Overview', href: '/admin/seo' },
  { label: 'Competitors', href: '/admin/seo/competitors' },
  { label: 'Queries', href: '/admin/seo/queries' },
  { label: 'SERP Intelligence', href: '/admin/seo/serp' },
  { label: 'Market Share', href: '/admin/seo/market-share' },
  { label: 'Opportunities', href: '/admin/seo/opportunities' },
  { label: 'Technical SEO', href: '/admin/seo/technical' },
  { label: 'Integrations', href: '/admin/seo/integrations' },
  // Tranche 2 (2026-08-13): the Sync Operations Center of the Search
  // Integrations Control Plane.
  { label: 'Sync Operations', href: '/admin/seo/integrations/sync' },
  { label: 'Content & Experiments', href: '/admin/seo/content' },
  { label: 'AEO', href: '/admin/seo/aeo' },
  // Tranche 2 (2026-08-13): the three catalogue-intelligence surfaces.
  { label: 'Battery Compatibility', href: '/admin/seo/battery-compatibility' },
  { label: 'Storage Testing', href: '/admin/seo/storage-tests' },
  { label: 'Product Lifecycle SEO', href: '/admin/seo/product-lifecycle' },
  // Wave 3: derived competitor matrix and the observation-to-outcome queue.
  { label: 'Category × Competitor', href: '/admin/seo/category-matrix' },
  { label: 'Work Queue', href: '/admin/seo/work-queue' },
  { label: 'Raw vs Rendered', href: '/admin/seo/render-diff' },
  { label: 'Crawler Logs', href: '/admin/seo/crawler-logs' },
  { label: 'robots.txt', href: '/admin/seo/robots' },
  { label: 'Core Web Vitals', href: '/admin/seo/web-vitals' },
  { label: 'Organic Intelligence', href: '/admin/seo/opportunities-intel' },
];

const PAGES = path.resolve(__dirname, '../../apps/web/src/pages');

describe('Search Growth admin navigation', () => {
  it('registers every Organic Growth OS page in the Search Growth group', () => {
    const items = ADMIN_NAVIGATION_ITEMS.filter((i) => i.group === 'Search Growth');
    for (const expected of EXPECTED) {
      const item = items.find((i) => i.href === expected.href);
      expect(item, `nav item for ${expected.href}`).toBeDefined();
      expect(item!.label).toBe(expected.label);
      expect(item!.status).toBe('working');
      expect(item!.description.length).toBeGreaterThan(10);
    }
    expect(items).toHaveLength(EXPECTED.length);
  });

  it('exposes the Search Growth group in the grouped navigation', () => {
    const group = ADMIN_NAVIGATION.find((g) => g.title === 'Search Growth');
    expect(group).toBeDefined();
    expect(group!.items.map((i) => i.href)).toEqual(EXPECTED.map((e) => e.href));
  });

  it('every Search Growth href maps to a real page file', () => {
    for (const { href } of EXPECTED) {
      const rel = href.replace(/^\//, '');
      const asFile = path.join(PAGES, `${rel}.astro`);
      const asIndex = path.join(PAGES, rel, 'index.astro');
      expect(
        fs.existsSync(asFile) || fs.existsSync(asIndex),
        `${href} should resolve to ${asFile} or ${asIndex}`,
      ).toBe(true);
    }
  });
});
