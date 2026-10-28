import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { trailingSlashTarget } from '../../apps/web/src/lib/pageAddress';
import { policyBySlug } from '../../apps/web/src/lib/legal-policies';
import { RETURNS_POLICY } from '../../apps/web/src/lib/returnsPolicy';

/**
 * Review of everything shipped 2026-10-24 → 2026-10-28 (PRs #177–#190) and the
 * loose ends found alongside it. One block per fix, so a regression names the
 * finding it reopened.
 */
const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('one address per page', () => {
  it('a slashed page address goes to the bare one, query kept', () => {
    expect(trailingSlashTarget('GET', '/shop/', '?category=power')).toBe('/shop?category=power');
    expect(trailingSlashTarget('GET', '/phone-batteries/tecno-spark-7-kf6n/')).toBe('/phone-batteries/tecno-spark-7-kf6n');
    expect(trailingSlashTarget('HEAD', '/products/bl-49ft-battery//')).toBe('/products/bl-49ft-battery');
    expect(trailingSlashTarget('GET', '//')).toBe('/');
  });
  it('leaves the root, bare addresses, writes, relays, assets and machine endpoints alone', () => {
    expect(trailingSlashTarget('GET', '/')).toBeNull();
    expect(trailingSlashTarget('GET', '/shop')).toBeNull();
    expect(trailingSlashTarget('POST', '/cart/')).toBeNull();
    expect(trailingSlashTarget('GET', '/api/battery-finder/event/')).toBeNull();
    expect(trailingSlashTarget('GET', '/_astro/chunk/')).toBeNull();
    expect(trailingSlashTarget('GET', '/.well-known/mcp/')).toBeNull();
  });
  it('the middleware applies it after the moved-pages rule (one hop, not two)', () => {
    const mw = read('apps/web/src/middleware.ts');
    const moved = mw.indexOf('const moved = MOVED_PATHS[');
    const slash = mw.indexOf('trailingSlashTarget(context.request.method');
    expect(moved).toBeGreaterThan(0);
    expect(slash).toBeGreaterThan(moved);
    expect(mw).not.toMatch(/\^\\\/products\\\/\[\^\/\]\+\\\/\+\$/); // the old product-only rule is gone
  });
});

describe('error pages are not pages', () => {
  it('404 and 500 declare themselves error pages: no canonical, no og:url, noindex', () => {
    for (const f of ['apps/web/src/pages/404.astro', 'apps/web/src/pages/500.astro']) expect(read(f), f).toMatch(/<BaseLayout [^>]*\berrorPage>/);
    const layout = read('apps/web/src/layouts/BaseLayout.astro');
    expect(layout).toContain('{!errorPage && <link rel="canonical" href={canonical} />}');
    expect(layout).toContain('{!errorPage && <meta property="og:url" content={canonical} />}');
    expect(layout).toContain("const robotsMeta = robotsMetaProp ?? (errorPage ? 'noindex,follow' : undefined);");
  });
});

describe('the returns page says what the policy is', () => {
  it('its search description states the window, the condition and the faulty promise from the one returns fact', () => {
    const summary = policyBySlug('returns')!.summary;
    expect(summary).toContain(`within ${RETURNS_POLICY.windowDays} days`);
    expect(summary).toMatch(/unused and complete/);
    expect(summary).toMatch(/replace or refund/);
    expect(summary.length).toBeGreaterThanOrEqual(110);
    expect(summary.length).toBeLessThanOrEqual(160);
  });
});
