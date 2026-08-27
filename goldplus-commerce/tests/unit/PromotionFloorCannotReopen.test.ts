import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validatePromotionVersion } from '../../apps/api/src/domain/pricing/Pricing';
import type { PromotionVersionDraft } from '../../apps/api/src/domain/pricing/Pricing';
import { STOREFRONT_PRICE_FLOOR_UGX } from '../../packages/shared/src/batteries';

/**
 * No promotion may reopen the UGX 145,000 storefront floor.
 *
 * The floor is the owner's standing rule and the catalogue and the display both
 * hold it, but a PROMOTION carries its own `priceFloorUgx` and the evaluator
 * honours whatever it is told. Nothing checked that value against the storefront
 * floor, and the admin "create next immutable version" form did not offer the
 * field at all: it posted `priceFloorUgx: 0` on every submission.
 *
 * So the next version of the live launch promotion would have discounted
 * straight through the floor, and the storefront, which reads the floor from the
 * same version, would have advertised the lower price as if it were correct.
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
  priceFloorUgx: STOREFRONT_PRICE_FLOOR_UGX,
  ...over,
});

describe('a promotion version may not price below the storefront floor', () => {
  it('accepts the storefront floor itself', () => {
    expect(validatePromotionVersion(draft())).toEqual([]);
  });

  it('accepts a HIGHER floor, which protects more, not less', () => {
    expect(validatePromotionVersion(draft({ priceFloorUgx: 200_000 }))).toEqual([]);
  });

  it('refuses zero, which is what the admin form used to send', () => {
    const errors = validatePromotionVersion(draft({ priceFloorUgx: 0 }));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).toMatch(/at least UGX 145,000/);
  });

  it('refuses one shilling below the floor', () => {
    expect(validatePromotionVersion(draft({ priceFloorUgx: STOREFRONT_PRICE_FLOOR_UGX - 1 })).length)
      .toBeGreaterThan(0);
  });

  it('still refuses a non-integer amount', () => {
    expect(validatePromotionVersion(draft({ priceFloorUgx: 145_000.5 })))
      .toContain('Price floor must be a non-negative integer UGX amount.');
  });
});

describe('the admin pages can no longer send a floor-breaking version', () => {
  const read = (f: string) => readFileSync(resolve(__dirname, '../..', f), 'utf8');

  for (const page of [
    'apps/web/src/pages/admin/pricing/index.astro',
    'apps/web/src/pages/admin/pricing/[id].astro',
  ]) {
    it(`${page} defaults the floor to the storefront floor`, () => {
      const src = read(page);
      expect(src).toMatch(/priceFloorUgx: Number\(form\.get\('priceFloorUgx'\) \|\| STOREFRONT_PRICE_FLOOR_UGX\)/);
      // Used in frontmatter, so it must actually be imported: tsc does not
      // check .astro frontmatter, and a missing import here is a runtime
      // ReferenceError that a passing build will not reveal.
      expect(src).toMatch(/import \{ STOREFRONT_PRICE_FLOOR_UGX \} from '@goldplus\/shared';/);
    });

    it(`${page} lets the operator see and set the floor`, () => {
      expect(read(page)).toMatch(/name="priceFloorUgx"/);
    });
  }

  it('the admin API refuses a below-floor version at the boundary too', () => {
    expect(read('apps/api/src/interfaces/http/routes/admin/pricing.ts'))
      .toMatch(/priceFloorUgx: z\.number\(\)\.int\(\)\.min\(STOREFRONT_PRICE_FLOOR_UGX\)/);
  });
});
