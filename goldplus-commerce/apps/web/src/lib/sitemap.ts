/**
 * U6 — sitemap building blocks, exported from a lib module so the static list
 * and XML shaping are unit-testable (tests/unit/SeoWiring.test.ts).
 *
 * /sitemap.xml is an INDEX pointing at three child sitemaps under /sitemaps/:
 * static pages, products (real updated_at lastmod, from the API's seoRepo) and
 * categories (taxonomy).
 */

/** Canonical public host for every sitemap URL. */
export const SITE_ORIGIN = 'https://shopgoldplus.com';

/**
 * Hand-listed static pages — INDEXABLE ones only. Cart/checkout/account/auth/
 * admin flows are noindex (see the robotsMeta prop on those pages) and must
 * never appear here.
 */
export const STATIC_SITEMAP_PATHS: readonly string[] = [
  '/',
  '/shop',
  '/product-finder',
  '/verification',
  '/faq',
  '/support',
  '/support/issue',
  '/support/fake',
  '/loyalty',
  '/dealers/apply',
  '/quote-request',
  '/returns',
  '/warranty',
  '/terms',
  '/privacy',
];

/** Path prefixes that are noindex and therefore banned from every sitemap. */
export const NON_INDEXABLE_PREFIXES: readonly string[] = [
  '/cart',
  '/checkout',
  '/account',
  '/admin',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/logout',
  '/compare',
  '/track-order',
];

export function isIndexablePath(path: string): boolean {
  return !NON_INDEXABLE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
}

export interface SitemapUrl {
  /** Absolute URL or site-relative path (joined onto SITE_ORIGIN). */
  loc: string;
  /** ISO timestamp; omitted from the XML when absent (static pages). */
  lastmod?: string;
}

const absolute = (loc: string) => (loc.startsWith('http') ? loc : SITE_ORIGIN + loc);

export function urlsetXml(urls: SitemapUrl[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map((u) => {
        const lastmod = u.lastmod ? `\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>` : '';
        return `  <url>\n    <loc>${escapeXml(absolute(u.loc))}</loc>${lastmod}\n  </url>`;
      })
      .join('\n') +
    `\n</urlset>\n`
  );
}

export function sitemapIndexXml(paths: string[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    paths.map((p) => `  <sitemap>\n    <loc>${escapeXml(absolute(p))}</loc>\n  </sitemap>`).join('\n') +
    `\n</sitemapindex>\n`
  );
}

export function xmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=900',
    },
  });
}
