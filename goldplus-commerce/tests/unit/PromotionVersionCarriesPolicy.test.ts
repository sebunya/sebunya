import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildNextVersionDraft, describeVersionPolicy } from '../../apps/web/src/lib/pricingVersionDraft';

/**
 * "Create next immutable version" posted a hardcoded payload: couponCode null,
 * no conditions, no exclusions, every usage limit null, not stackable, and a
 * benefit with no targets or cap. Extending coupon GOLD10 by a week produced a
 * v2 with NO code and NO limits — an automatic 10% off every basket for every
 * visitor, advertised site-wide — and at 10% no second approver is required.
 */

const GOLD10 = {
  id: 'v1',
  versionNumber: 1,
  conditions: [{ type: 'MIN_CART_SUBTOTAL', value: 150000 }],
  benefits: [{ type: 'PERCENTAGE_OFF', value: 1000, targetProductIds: ['11111111-1111-4111-8111-111111111111'], maximumDiscountUgx: 50000 }],
  exclusions: [{ type: 'CATEGORY', value: 'batteries' }],
  schedule: { startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-09-30T00:00:00Z' },
  usagePolicy: { globalLimit: 200, perCustomerLimit: 1, perCouponLimit: 200, reservationTtlSeconds: 600 },
  priority: 5,
  stackable: true,
  couponCode: 'GOLD10',
  priceFloorUgx: 0,
};

const extend = { startsAt: '2026-10-01T00:00', endsAt: '2026-10-07T00:00', benefitType: 'PERCENTAGE_OFF', benefitValue: 1000, priority: 5, priceFloorUgx: 0 };

describe('the next version keeps everything the form does not show', () => {
  const next = buildNextVersionDraft(GOLD10, extend);

  it('keeps the coupon code, so a coupon never becomes an automatic discount', () => {
    expect(next.couponCode).toBe('GOLD10');
  });

  it('keeps the usage limits', () => {
    expect(next.usagePolicy).toEqual(GOLD10.usagePolicy);
  });

  it('keeps conditions, exclusions and stackability', () => {
    expect(next.conditions).toEqual(GOLD10.conditions);
    expect(next.exclusions).toEqual(GOLD10.exclusions);
    expect(next.stackable).toBe(true);
  });

  it("keeps the benefit's product targets and cap while taking the form's type and value", () => {
    const changed = buildNextVersionDraft(GOLD10, { ...extend, benefitValue: 1500 });
    expect(changed.benefits).toEqual([
      { type: 'PERCENTAGE_OFF', value: 1500, targetProductIds: GOLD10.benefits[0].targetProductIds, maximumDiscountUgx: 50000 },
    ]);
  });

  it('takes the schedule, priority and extra floor from the form', () => {
    expect(next.schedule).toEqual({ startsAt: extend.startsAt, endsAt: extend.endsAt });
    const other = buildNextVersionDraft(GOLD10, { ...extend, priority: 9, priceFloorUgx: 145000 });
    expect(other.priority).toBe(9);
    expect(other.priceFloorUgx).toBe(145000);
  });

  it('a version with no coupon and no limits stays that way', () => {
    const open = buildNextVersionDraft({ ...GOLD10, couponCode: null, usagePolicy: { globalLimit: null, perCustomerLimit: null, perCouponLimit: null, reservationTtlSeconds: 900 }, stackable: false }, extend);
    expect(open.couponCode).toBeNull();
    expect(open.usagePolicy.globalLimit).toBeNull();
    expect(open.stackable).toBe(false);
  });
});

describe('the approver can see what a version carries', () => {
  it('names the coupon, conditions and limits', () => {
    const line = describeVersionPolicy(GOLD10);
    expect(line).toContain('Coupon GOLD10');
    expect(line).toContain('MIN_CART_SUBTOTAL 150000');
    expect(line).toContain('per customer 1');
    expect(line).toContain('total 200');
  });

  it('says plainly when a version applies to everyone automatically', () => {
    expect(describeVersionPolicy({ ...GOLD10, couponCode: null, conditions: [] })).toContain('No coupon — applies automatically');
  });
});

describe('the admin page builds the version from the base, not a literal', () => {
  const page = readFileSync(resolve(__dirname, '../../apps/web/src/pages/admin/pricing/[id].astro'), 'utf8');

  it('no longer hardcodes a null coupon or empty conditions', () => {
    expect(page).not.toMatch(/couponCode: null/);
    expect(page).not.toMatch(/conditions: \[\]/);
    expect(page).toMatch(/buildNextVersionDraft\(base,/);
  });

  it('sends the base version id and shows each version\'s policy', () => {
    expect(page).toMatch(/name="baseVersionId"/);
    expect(page).toMatch(/describeVersionPolicy\(version\)/);
  });
});
