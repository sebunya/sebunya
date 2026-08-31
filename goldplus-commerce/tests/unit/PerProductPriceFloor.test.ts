import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectiveFloorUgx, salePriceUgx, campaignSaves } from '../../packages/shared/src/pricing/salePrice';
import { parsePriceTiers } from '../../apps/api/src/domain/products/PriceTiers';
import { evaluatePricing } from '../../apps/api/src/domain/pricing/PricingEvaluator';

/**
 * The owner's pricing rule (0127): the website sells at Price D, and once any
 * discount is applied the price must never go below that product's own Price A.
 *
 * The floor is PER PRODUCT. A shop-wide 145,000 — the floor of the original
 * eight products — blocked 165 of the real catalogue's 184 products from being
 * listed at all and made every discount on a UGX 4,000 cable compute to zero.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('effectiveFloorUgx: the one place the rule is stated', () => {
  it('a product with a floor is held at the higher of its floor and the campaign floor', () => {
    expect(effectiveFloorUgx(0, 2_500, 4_000)).toBe(2_500);
    expect(effectiveFloorUgx(3_000, 2_500, 4_000)).toBe(3_000);
  });

  it('a product with NO floor is not discountable — the floor is its retail price', () => {
    expect(effectiveFloorUgx(0, null, 4_000)).toBe(4_000);
    expect(effectiveFloorUgx(0, undefined, 4_000)).toBe(4_000);
    expect(effectiveFloorUgx(0, 0, 4_000)).toBe(4_000);
    expect(salePriceUgx(4_000, 1000, effectiveFloorUgx(0, null, 4_000))).toBe(4_000);
    expect(campaignSaves(4_000, 1000, effectiveFloorUgx(0, null, 4_000))).toBe(false);
  });

  it('a 10% campaign on a UGX 4,000 cable with a UGX 2,500 floor takes 400 off — it used to take nothing', () => {
    expect(salePriceUgx(4_000, 1000, effectiveFloorUgx(0, 2_500, 4_000))).toBe(3_600);
    // Under the old shop-wide floor the same line computed to no saving at all.
    expect(salePriceUgx(4_000, 1000, 145_000)).toBe(4_000);
  });

  it('a discount never crosses Price A, however deep', () => {
    // Price D 7,000, Price A 4,000: a 90% campaign stops at 4,000.
    expect(salePriceUgx(7_000, 9000, effectiveFloorUgx(0, 4_000, 7_000))).toBe(4_000);
  });
});

describe('the evaluator honours each line\'s own floor', () => {
  const rule = (priceFloorUgx: number) => ({
    definitionId: 'd', definitionKey: 'launch', versionId: 'v', versionNumber: 1,
    conditions: [], benefits: [{ type: 'PERCENTAGE_OFF' as const, value: 5000 }], exclusions: [],
    schedule: { startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: new Date('2027-01-01T00:00:00Z') },
    usagePolicy: { globalLimit: null, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 },
    priority: 0, stackable: false, couponCode: null, priceFloorUgx,
  });
  const base = { quoteId: 'q', couponCode: null, couponReference: null, customerDnaSegments: [], experimentEvidence: [], shippingUgx: 0, taxUgx: 0, evaluatedAt: new Date('2026-06-01T00:00:00Z'), expiresAt: new Date('2026-06-01T00:05:00Z') };

  it('two products in one basket each stop at their OWN Price A', () => {
    const quote = evaluatePricing({
      ...base,
      rules: [rule(0)],
      lines: [
        { productId: 'cable', sku: 'C', name: 'Cable', category: 'Cables', canonicalUnitPriceUgx: 4_000, floorUnitPriceUgx: 2_500, quantity: 2 },
        { productId: 'card', sku: 'M', name: 'Memory card', category: 'Storage', canonicalUnitPriceUgx: 500_000, floorUnitPriceUgx: 275_000, quantity: 1 },
      ],
    } as never);
    // 50% off: cable wants 4,000 off but may only take 3,000 (2 × 1,500);
    // card wants 250,000 off but may only take 225,000 (down to 275,000).
    expect(quote.discountTotalUgx).toBe(3_000 + 225_000);
  });

  it('the promotion floor is an extra, combined per line with max()', () => {
    const quote = evaluatePricing({
      ...base,
      rules: [rule(3_500)],
      lines: [{ productId: 'cable', sku: 'C', name: 'Cable', category: 'Cables', canonicalUnitPriceUgx: 4_000, floorUnitPriceUgx: 2_500, quantity: 1 }],
    } as never);
    expect(quote.discountTotalUgx).toBe(500);
  });

  it('the line builder passes the product floor, and retail when there is none', () => {
    const src = read('apps/api/src/application/use-cases/pricing/EvaluateCartPricingUseCase.ts');
    expect(src).toMatch(/floorUnitPriceUgx: effectiveFloorUgx\(0, product\.floorPriceUgx, product\.retailPriceUgx!\)/);
    expect(read('apps/api/src/domain/pricing/PricingEvaluator.ts').match(/Math\.max\(rule\.priceFloorUgx, line\.floorUnitPriceUgx \?\? 0\)/g)?.length).toBe(2);
  });
});

describe('the tiers a product may carry', () => {
  it('a floor above the selling price is refused — no discount could ever apply', () => {
    const r = parsePriceTiers({ floorPriceUgx: 4_500 }, 4_000);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/cannot be above the selling price/);
  });
  it('a floor equal to the selling price is allowed (never discounted, by choice)', () => {
    expect(parsePriceTiers({ floorPriceUgx: 4_000 }, 4_000)).toEqual({ ok: true, value: { floorPriceUgx: 4_000, tierBPriceUgx: null, tierCPriceUgx: null } });
  });
  it('blank tiers are null, not zero', () => {
    expect(parsePriceTiers({ floorPriceUgx: '', tierBPriceUgx: null }, 4_000)).toEqual({ ok: true, value: { floorPriceUgx: null, tierBPriceUgx: null, tierCPriceUgx: null } });
  });
  it('a zero or fractional tier is refused', () => {
    expect(parsePriceTiers({ floorPriceUgx: 0 }, 4_000).ok).toBe(false);
    expect(parsePriceTiers({ tierBPriceUgx: 12.5 }, 4_000).ok).toBe(false);
  });
});

describe('the write paths cannot trip the CHECK by accident', () => {
  it('admin create/update write retail and tiers in ONE statement', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/products.ts');
    expect(route).toMatch(/createProduct\(productEntity, categoryId, tiers\.value\)/);
    expect(route).toMatch(/updateProductProperties\(productEntity, categoryId, tiers\.value\)/);
    expect(route).not.toMatch(/setPriceTiers\(/);
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts');
    expect(repo).toMatch(/set\(\{ retailPrice: product\.priceUgx, \.\.\.tierColumns\(tiers\) \}\)/);
  });
  it("a battery price below the battery's own floor is refused with a message, in the use case AND the repository", () => {
    expect(read('apps/api/src/application/use-cases/batteries/BatteryCatalogueUseCases.ts')).toMatch(/is below this battery's floor \(Price A\)/);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleBatteryCatalogueRepository.ts')).toMatch(/PRICE_BELOW_FLOOR: UGX/);
  });
});

describe('no storefront surface reads only the first 50 products', () => {
  it('every catalogue-wide surface pages through the whole catalogue', () => {
    for (const f of [
      'apps/web/src/pages/index.astro',
      'apps/web/src/pages/products/[slug].astro',
      'apps/web/src/components/recommendations/RecentlyViewedRail.astro',
      'apps/web/src/lib/navFeatured.ts',
    ]) {
      expect(read(f), f).not.toMatch(/products\?limit=50/);
      expect(read(f), f).toMatch(/fetchApprovedCatalogue\(apiBase\)/);
    }
  });
});

describe('the database holds the rule too', () => {
  it('0127 adds the floor with a CHECK that it never exceeds the retail price, and backfills the eight', () => {
    const sql = read('apps/api/src/infrastructure/db/migrations/0127_product_price_floor.sql');
    expect(sql).toMatch(/check \(floor_price is null or \(floor_price > 0 and floor_price <= retail_price\)\)/);
    expect(sql).toMatch(/update product_prices set floor_price = 145000 where floor_price is null/);
  });

  it('the public DTO and the products query carry the floor', () => {
    expect(read('packages/shared/src/types/product.ts')).toMatch(/floorPriceUgx: number \| null;/);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts')).toMatch(/floorPriceUgx: floorByProduct\.get\(row\.id\) \?\? null/);
  });

  it('nothing outside the historical note enforces 145,000 as a minimum', () => {
    for (const f of [
      'apps/api/src/domain/pim/PimImport.ts',
      'apps/api/src/domain/batteries/BatteryImport.ts',
      'apps/api/src/domain/batteries/BatteryReadiness.ts',
      'apps/api/src/interfaces/http/routes/admin/products.ts',
      'apps/web/src/pages/admin/products/new.astro',
    ]) {
      expect(read(f), f).not.toMatch(/STOREFRONT_PRICE_FLOOR_UGX/);
    }
  });

  it('the pricing preview can be a dry run, so the basket pages show the evaluator\'s figure without minting quotes', () => {
    expect(read('apps/api/src/interfaces/http/routes/commerce.ts')).toMatch(/const persist = body\?\.dryRun !== true;/);
  });
});
