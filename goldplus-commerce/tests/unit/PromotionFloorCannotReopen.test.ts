import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePromotionVersion } from '../../apps/api/src/domain/pricing/Pricing';
import type { PromotionVersionDraft } from '../../apps/api/src/domain/pricing/Pricing';

/**
 * The floor no promotion can reopen is each PRODUCT'S OWN (Price A, 0127).
 *
 * This file used to pin a single storefront-wide floor of UGX 145,000 onto
 * every promotion. That number was the floor of the original eight products,
 * mistaken for a shop-wide minimum: applied to the real 184-product catalogue
 * it blocked 90% of it from being listed and made every discount on a UGX
 * 4,000 cable compute to nothing. The owner's actual rule is per product — sell
 * at Price D, never discount below Price A — and the evaluator now applies
 * max(promotion floor, product floor) per line. A promotion's own floor is an
 * optional EXTRA, so 0 is the normal value: "the product floors govern".
 */

const draft = (over: Partial<PromotionVersionDraft> = {}): PromotionVersionDraft => ({
  conditions: [],
  benefits: [{ type: 'PERCENTAGE_OFF', value: 1000 }],
  exclusions: [],
  schedule: { startsAt: new Date('2026-09-01T00:00:00Z'), endsAt: new Date('2026-10-01T00:00:00Z') },
  usagePolicy: { globalLimit: null, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 },
  priority: 0,
  stackable: false,
  couponCode: null,
  priceFloorUgx: 0,
  ...over,
});

describe("a promotion's floor is an optional extra; the product floor is the rule", () => {
  it('accepts zero — the product floors govern', () => {
    expect(validatePromotionVersion(draft({ priceFloorUgx: 0 }))).toEqual([]);
  });

  it('accepts an extra floor of any positive amount', () => {
    expect(validatePromotionVersion(draft({ priceFloorUgx: 200_000 }))).toEqual([]);
    expect(validatePromotionVersion(draft({ priceFloorUgx: 5_000 }))).toEqual([]);
  });

  it('still refuses a negative or non-integer amount', () => {
    expect(validatePromotionVersion(draft({ priceFloorUgx: -1 }))).toContain('Price floor must be a non-negative integer UGX amount.');
    expect(validatePromotionVersion(draft({ priceFloorUgx: 145_000.5 }))).toContain('Price floor must be a non-negative integer UGX amount.');
  });

  it('no promotion path enforces the historical 145,000 as a minimum', () => {
    const read = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');
    for (const f of [
      'apps/api/src/domain/pricing/Pricing.ts',
      'apps/api/src/interfaces/http/routes/admin/pricing.ts',
      'apps/web/src/pages/admin/pricing/index.astro',
      'apps/web/src/pages/admin/pricing/[id].astro',
    ]) {
      expect(read(f), f).not.toMatch(/STOREFRONT_PRICE_FLOOR_UGX/);
    }
    expect(read('apps/api/src/interfaces/http/routes/admin/pricing.ts')).toMatch(/priceFloorUgx: z\.number\(\)\.int\(\)\.min\(0\)/);
  });
});

describe('the admin pages default the extra floor to 0 and still let the operator set one', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');
  for (const page of ['apps/web/src/pages/admin/pricing/index.astro', 'apps/web/src/pages/admin/pricing/[id].astro']) {
    it(page, () => {
      const src = read(page);
      expect(src).toMatch(/priceFloorUgx: Number\(form\.get\('priceFloorUgx'\) \|\| 0\)/);
      expect(src).toMatch(/name="priceFloorUgx"/);
    });
  }
});
