import { describe, expect, it } from 'vitest';
import { STOREFRONT_PRICE_FLOOR_UGX } from '../../packages/shared/src/batteries';
import {
  assertActivationWindow,
  canTransitionPromotion,
  normalizeCouponCode,
  PromotionVersionDraft,
  validatePromotionVersion,
} from '../../apps/api/src/domain/pricing/Pricing';

const version = (overrides: Partial<PromotionVersionDraft> = {}): PromotionVersionDraft => ({
  conditions: [{ type: 'MIN_CART_SUBTOTAL', value: 100_000 }],
  benefits: [{ type: 'PERCENTAGE_OFF', value: 1000, maximumDiscountUgx: 50_000 }],
  exclusions: [{ type: 'CATEGORY', value: 'regulated' }],
  schedule: { startsAt: new Date('2026-07-01T00:00:00Z'), endsAt: new Date('2026-08-01T00:00:00Z') },
  usagePolicy: { globalLimit: 100, perCustomerLimit: 1, perCouponLimit: 100, reservationTtlSeconds: 900 },
  priority: 10,
  stackable: false,
  couponCode: ' july-safe ',
  // Was 1, an arbitrary value. A promotion floor may not sit below the
  // storefront floor (owner rule), so the fixture uses the real one.
  priceFloorUgx: STOREFRONT_PRICE_FLOOR_UGX,
  ...overrides,
});

describe('Pricing P1 governance', () => {
  it('accepts only the verified integer-UGX benefit contract', () => {
    expect(validatePromotionVersion(version())).toEqual([]);
    expect(validatePromotionVersion(version({ benefits: [{ type: 'PERCENTAGE_OFF', value: 10_001 }] }))).toContain('Percentage benefits use 1-10000 basis points.');
    expect(validatePromotionVersion(version({ priceFloorUgx: 0.5 }))).toContain('Price floor must be a non-negative integer UGX amount.');
    expect(normalizeCouponCode(' july-safe ')).toBe('JULY-SAFE');
  });

  it('requires review and approval before activation and never reactivates expired versions', () => {
    expect(canTransitionPromotion('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransitionPromotion('DRAFT', 'READY_FOR_REVIEW')).toBe(true);
    expect(canTransitionPromotion('READY_FOR_REVIEW', 'APPROVED')).toBe(true);
    expect(canTransitionPromotion('APPROVED', 'ACTIVE')).toBe(true);
    expect(canTransitionPromotion('EXPIRED', 'ACTIVE')).toBe(false);
  });

  it('enforces the effective window independently of deployment time', () => {
    expect(() => assertActivationWindow('APPROVED', version().schedule, new Date('2026-07-15T00:00:00Z'))).not.toThrow();
    expect(() => assertActivationWindow('APPROVED', version().schedule, new Date('2026-06-30T23:59:59Z'))).toThrow('has not started');
    expect(() => assertActivationWindow('APPROVED', version().schedule, new Date('2026-08-01T00:00:00Z'))).toThrow('cannot activate');
  });

  it('rejects malformed schedules, limits, empty benefits and coupon identifiers', () => {
    expect(validatePromotionVersion(version({ schedule: { startsAt: new Date('2026-08-01'), endsAt: new Date('2026-07-01') } }))).toContain('Promotion end time must be after its start time.');
    expect(validatePromotionVersion(version({ benefits: [] }))).toContain('At least one benefit is required.');
    expect(validatePromotionVersion(version({ usagePolicy: { globalLimit: 0, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 10 } }))).toEqual(expect.arrayContaining(['Usage limits must be positive integers when configured.', 'Reservation TTL must be between 60 and 86400 seconds.']));
    expect(validatePromotionVersion(version({ couponCode: 'unsafe code!' }))).toContain('Coupon code must be a 3-40 character bounded identifier.');
  });
});
