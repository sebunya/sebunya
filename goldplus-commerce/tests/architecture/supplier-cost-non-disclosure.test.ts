import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Supplier-cost non-disclosure contract (R4 §6.4, AC13).
 *
 * Supplier cost is secured data: it must never enter a public product, search,
 * recommendation, cart, checkout or order response. The cost owners
 * (product_cost_entries, product_prices.cost_price, order_items.cogs_snapshot_ugx)
 * are written and read only behind admin permissions.
 *
 * This test fails the moment cost vocabulary appears in a public route module,
 * the public product mapper, or the shared public DTO types — BEFORE a leak
 * reaches a response body.
 */
const root = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

// Word-boundary cost vocabulary. `cogs` and `supplier` are unambiguous;
// cost_price/costPrice are the owner columns. Generic words like "cost" alone
// are not banned — delivery fees and copy legitimately use them.
const COST_VOCABULARY = /\b(cost_price|costPrice|costPriceUgx|cogs|cogs_snapshot_ugx|cogsSnapshotUgx|supplierCost|supplier_cost|dealer_price|dealerPrice)\b/;

const PUBLIC_ROUTES_DIR = 'apps/api/src/interfaces/http/routes';

describe('supplier cost never enters a public contract (AC13)', () => {
  it('no PUBLIC route module carries cost vocabulary', () => {
    const dir = resolve(root, PUBLIC_ROUTES_DIR);
    const publicRouteFiles = readdirSync(dir)
      .filter((f) => f.endsWith('.ts')); // admin/ is a subdirectory — excluded by design
    expect(publicRouteFiles.length).toBeGreaterThan(10);
    for (const file of publicRouteFiles) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source, `${PUBLIC_ROUTES_DIR}/${file} must not reference supplier cost`).not.toMatch(COST_VOCABULARY);
    }
  });

  it('the public product mapper neither reads cost nor spreads a raw entity', () => {
    const mapper = read('apps/api/src/application/mappers/toProductPublicDto.ts');
    expect(mapper).not.toMatch(COST_VOCABULARY);
    // A field-by-field mapper cannot leak a column it never names; a spread of
    // the raw row would leak every future column silently.
    expect(mapper).not.toMatch(/\.\.\.(product|row|entity|input)\b/);
  });

  it('the shared public DTO types carry no cost field', () => {
    const productTypes = read('packages/shared/src/types/product.ts');
    expect(productTypes).not.toMatch(COST_VOCABULARY);
    const checkoutTypes = read('packages/shared/src/types/checkout.ts');
    expect(checkoutTypes).not.toMatch(COST_VOCABULARY);
  });

  it('cost mutation routes live only behind admin permissions', () => {
    const costs = read('apps/api/src/interfaces/http/routes/admin/product-costs.ts');
    expect(costs).toContain('PERMISSIONS.PRODUCT_COSTS_MANAGE');
    expect(costs).toContain("routes.use('*', authMiddleware)");
    const media = read('apps/api/src/interfaces/http/routes/admin/recommendations.ts');
    expect(media).toContain('PERMISSIONS.RECOMMENDATIONS_MANAGE');
  });
});
