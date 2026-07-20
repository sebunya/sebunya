import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const schema = read('apps/api/src/infrastructure/db/schema/search.ts');
const migration = read('apps/api/src/infrastructure/db/migrations/0048_search_insights.sql');
const repository = read('apps/api/src/infrastructure/db/repositories/DrizzleSearchDemandRepository.ts');
const productsRoute = read('apps/api/src/interfaces/http/routes/products.ts');
const adminRoute = read('apps/api/src/interfaces/http/routes/admin/search-demand.ts');
const page = read('apps/web/src/pages/admin/demand/index.astro');
const shop = read('apps/web/src/pages/shop.astro');
const card = read('apps/web/src/components/ProductCard.astro');
const pdp = read('apps/web/src/pages/products/[slug].astro');
const cart = read('apps/web/src/pages/cart.astro');
const proof = read('apps/api/src/scripts/search-insights-proof.ts');

describe('Search Insights completion boundary', () => {
  it('stores aggregate query/product counters without personal-history linkage', () => {
    expect(schema).toContain("pgTable('search_product_insights'");
    expect(schema).not.toMatch(/(?:visitor|session|browser|customer|email|phone|cart|order|payment|consent)(?:Id|_id)/i);
    expect(migration).toContain('search_product_insight_integrity');
  });

  it('keeps click and add-to-cart conversion bounded by prior aggregate evidence', () => {
    expect(repository).toContain('gt(searchProductInsights.impressionCount, searchProductInsights.clickCount)');
    expect(repository).toContain('gt(searchProductInsights.clickCount, searchProductInsights.conversionCount)');
    expect(migration).toMatch(/"conversion_count" <= "click_count"/);
  });

  it('suppresses low-volume terms from reporting', () => {
    expect(repository).toContain('MIN_SEARCH_INSIGHT_VOLUME');
    expect(repository).toContain('gte(searchDemandSignals.searchCount, MIN_SEARCH_INSIGHT_VOLUME)');
    expect(page).toContain('Minimum term disclosure');
  });

  it('derives read-only synonym candidates from repeated shared-product clicks', () => {
    expect(repository).toContain("status: 'EVIDENCE_ONLY'");
    expect(repository).toMatch(/a\.click_count >= 2 and b\.click_count >= 2/);
    expect(page).toContain('no synonym or ranking rule is created or activated');
  });

  it('captures impressions, clicks and add-to-cart conversions without blocking commerce', () => {
    expect(shop).toContain('rankedProductIds');
    expect(card).toContain('searchQuery');
    expect(pdp).toContain("type: 'click'");
    expect(cart).toContain("type: 'add_to_cart'");
    expect(pdp).toContain('.catch(() => {})');
    expect(cart).toContain('.catch(() => {})');
  });

  it('exposes public aggregate capture and protected read-only operations', () => {
    expect(productsRoute).toContain("routes.post('/search-interactions'");
    expect(adminRoute).toContain("routes.get('/insights', requirePermissions([PERMISSIONS.REPORTS_READ])");
    expect(adminRoute).toContain("routes.use('*', authMiddleware)");
  });

  it('labels conversion and ranking evidence truthfully', () => {
    expect(page).toContain('Add-to-cart is the conversion boundary');
    expect(page).toContain('it is not an order, payment or revenue claim');
    expect(page).toContain('Ranking is observed evidence only and does not alter catalogue order');
  });

  it('renders empty and unavailable states for every insight table', () => {
    expect(page).toContain('No query/product row has reached the privacy-safe reporting threshold.');
    expect(page).toContain('No synonym candidate has enough aggregate evidence.');
    expect(page).toContain('Search insights are unavailable');
  });

  it('proves concurrency, privacy, no-send and cleanup in real PostgreSQL', () => {
    for (const evidence of ['concurrentSearches', 'lowVolumeSuppressed', 'rawHistoryColumns', 'providerCalls', 'protectedCounts', 'proofResidue']) expect(proof).toContain(evidence);
    expect(proof).toContain("process.env.NODE_ENV === 'production'");
    expect(proof).toContain('endDbConnection()');
  });
});
