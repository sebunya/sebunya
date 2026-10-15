import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EvaluateCartPricingUseCase } from '../../apps/api/src/application/use-cases/pricing/EvaluateCartPricingUseCase';
import { couponUsableAt, type CouponRecord } from '../../apps/api/src/application/ports/ICouponRepository';

/**
 * /admin/modules/coupons/batch generated codes nothing honoured: pricing matched only a version's own single code,
 * so a handed-out code read "doesn't match a live offer", and a promotion with batch codes but no code of its own
 * applied to everyone, code or not. Checkout never counted a redemption either.
 */
const NOW = new Date('2026-10-15T08:00:00Z');
const products: any = { findPublicViewList: async () => [{ entity: { id: 'p1', sku: 'P1', name: 'Battery', category: 'A' }, retailPriceUgx: 100_000, floorPriceUgx: 50_000, categoryName: 'A' }] };
const quotes: any = { saveQuote: async () => undefined };
const version = (definitionId: string, couponCode: string | null) => ({
  definition: { id: definitionId, key: definitionId },
  version: { id: `v-${definitionId}`, versionNumber: 1, conditions: [], benefits: [{ type: 'FIXED_AMOUNT_OFF', value: 10_000 }], exclusions: [], schedule: { startsAt: new Date('2026-01-01'), endsAt: new Date('2027-01-01') }, usagePolicy: {}, priority: 1, stackable: true, couponCode, priceFloorUgx: null },
});
const coupon = (over: Partial<CouponRecord> = {}): CouponRecord => ({
  id: 'c1', promotionDefinitionId: 'batch-promo', code: 'GP7KQ2', codeNormalised: 'GP7KQ2', codeType: 'bulk_batch',
  maxRedemptions: 1, redemptionCount: 0, isActive: true, startsAt: null, expiresAt: null, ...over,
});

function run(couponCode: string | null, found: CouponRecord | null, listed = [version('batch-promo', null), version('own-code', 'SAVE10')]) {
  const pricing: any = { listActiveVersions: async () => listed };
  const coupons = {
    findByNormalisedCode: async (c: string) => (found && found.codeNormalised === c ? found : null),
    definitionsWithActiveCodes: async () => new Set(['batch-promo']),
  };
  return new EvaluateCartPricingUseCase(products, pricing, quotes, undefined, coupons)
    .execute({ items: [{ productId: 'p1', quantity: 1 }], couponCode, persist: false, evaluatedAt: NOW });
}
const applied = async (q: Promise<{ appliedPromotionVersions: Array<{ definitionId: string }> }>) => (await q).appliedPromotionVersions.map((v) => v.definitionId).sort();

describe('batch coupon codes at pricing', () => {
  it('a generated code unlocks its promotion', async () => {
    expect(await applied(run('gp7kq2', coupon()))).toEqual(['batch-promo']);
  });

  it('a promotion that has batch codes no longer applies to everyone without one', async () => {
    expect(await applied(run(null, null))).toEqual([]);
    expect(await applied(run('NOPE12', null))).toEqual([]);
  });

  it('a used-up, inactive, early or expired code unlocks nothing', async () => {
    for (const over of [{ redemptionCount: 1 }, { isActive: false }, { startsAt: new Date('2026-11-01') }, { expiresAt: new Date('2026-10-01') }]) {
      expect(await applied(run('GP7KQ2', coupon(over))), JSON.stringify(over)).toEqual([]);
    }
  });

  it("a version's own single code still works as before", async () => {
    expect(await applied(run('SAVE10', null))).toEqual(['own-code']);
  });

  it('couponUsableAt is the one rule', () => {
    expect(couponUsableAt(coupon(), NOW)).toBe(true);
    expect(couponUsableAt(coupon({ maxRedemptions: null, redemptionCount: 99 }), NOW)).toBe(true);
    expect(couponUsableAt(coupon({ expiresAt: NOW }), NOW)).toBe(false);
  });
});

describe('checkout counts a batch code once its order exists', () => {
  it('CheckoutUseCase redeems after a NEW order is saved, never fatally; production wires the coupon repository', () => {
    const uc = readFileSync(join(__dirname, '../../apps/api/src/application/use-cases/commerce/CheckoutUseCase.ts'), 'utf8');
    expect(uc).toMatch(/if \(!saved\.duplicate && dto\.couponCode && this\.couponRedemption\) \{\s*await this\.couponRedemption\s*\.redeemForOrder\(\{ code: dto\.couponCode, orderId: saved\.order\.id, customerScopeKey, quote \}\)\s*\.catch\(\(\) => undefined\);/);
    const registry = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/Registry.ts'), 'utf8');
    expect(registry).toMatch(/this\.pricingCapacityRepo,\s*this\.couponRepo,\s*\);/);
    const adapter = registry.slice(registry.indexOf('redeemForOrder: async'), registry.indexOf("'COUPON_REDEMPTION_REFUSED_AFTER_ORDER'"));
    expect(adapter).toMatch(/a\.promotionDefinitionId === coupon\.promotionDefinitionId/);
    expect(adapter).toMatch(/if \(discountUgx <= 0\) return;/);
  });
});
