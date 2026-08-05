import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  VARIANCE_REASONS,
  decideVariance,
  isVarianceReason,
  riderCollectionAmount,
} from '../../apps/api/src/domain/delivery/DeliveryVariance';
import {
  DEFAULT_THRESHOLD_ORDERING,
  qualifiesForFreeDelivery,
  quoteCacheCanonicalString,
  quoteCacheKey,
  thresholdBasisUgx,
} from '../../apps/api/src/domain/delivery/DeliveryQuoteCache';
import { sameDayCutoff, eatDateString, isEatWeekend } from '../../packages/shared/src/time/eat';
import {
  ADDRESS_REVIEW_REASONS,
  MANUAL_QUOTE_REASONS,
  UNAVAILABLE_REASONS,
} from '../../apps/api/src/domain/delivery/DeliveryModel';

/**
 * Stage C: the commitment and the customer surface.
 *
 * The variance path has NO live orders to exercise — every production order is
 * unpaid and none has been delivered — so everything here is synthetic. That
 * is stated in the report rather than implied by green tests.
 */

const threshold = { absoluteUgx: 2000, shareBps: 2000 }; // 2,000 UGX or 20%

const variance = (over: Partial<Parameters<typeof decideVariance>[0]> = {}) =>
  decideVariance({
    reason: 'AREA_MISMATCH_ON_RESOLUTION',
    oldFeeUgx: 7500,
    newFeeUgx: 8000,
    note: null,
    handedOver: false,
    threshold,
    ...over,
  });

describe('a placed fee can only change for a listed reason', () => {
  it('accepts each of the five permitted reasons', () => {
    for (const reason of VARIANCE_REASONS) {
      const note = reason === 'MANUAL_ADJUSTMENT_BY_OPS' ? 'customer asked to move it across town' : null;
      expect(variance({ reason, note }).ok, `${reason} should be permitted`).toBe(true);
    }
  });

  it('REFUSES a reason outside the list — the test that tries', () => {
    const r = variance({ reason: 'RIDER_COVERED_MORE_GROUND' });
    expect(r).toMatchObject({ ok: false, refusal: 'REASON_NOT_PERMITTED' });
    // And says why, in the terms the brief uses.
    expect(r.ok === false && r.message).toMatch(/modelling error/i);
  });

  it('refuses other plausible-sounding inventions', () => {
    for (const bogus of ['FUEL_PRICE_ROSE', 'TRAFFIC_WAS_BAD', 'RIDER_REQUESTED_MORE', '']) {
      expect(variance({ reason: bogus }).ok, `${bogus} must be refused`).toBe(false);
      expect(isVarianceReason(bogus)).toBe(false);
    }
  });

  it('makes the catch-all reason explain itself', () => {
    expect(variance({ reason: 'MANUAL_ADJUSTMENT_BY_OPS', note: null })).toMatchObject({
      ok: false,
      refusal: 'REASON_REQUIRES_NOTE',
    });
    expect(variance({ reason: 'MANUAL_ADJUSTMENT_BY_OPS', note: 'short' })).toMatchObject({
      ok: false,
      refusal: 'REASON_REQUIRES_NOTE',
    });
    expect(variance({ reason: 'MANUAL_ADJUSTMENT_BY_OPS', note: 'moved to a different town entirely' }).ok).toBe(true);
  });

  it('cannot change an amount once the goods are with the customer', () => {
    expect(variance({ handedOver: true })).toMatchObject({ ok: false, refusal: 'ORDER_ALREADY_HANDED_OVER' });
  });
});

describe('absorption', () => {
  it('absorbs a small increase silently', () => {
    expect(variance({ newFeeUgx: 8000 })).toMatchObject({
      ok: true,
      disposition: { kind: 'absorbed', deltaUgx: 500 },
    });
  });

  it('needs the customer’s agreement above the threshold', () => {
    expect(variance({ newFeeUgx: 12_000 })).toMatchObject({
      ok: true,
      disposition: { kind: 'needs_agreement', deltaUgx: 4500 },
    });
  });

  it('absorbs only while inside EVERY configured threshold', () => {
    // 2,500 is over the 2,000 absolute but inside 20% of 7,500 (1,500)… no:
    // 20% of 7,500 is 1,500, so 2,500 breaches both. Use a case that breaches
    // exactly one: delta 1,800 is inside 2,000 absolute but over 1,500 share.
    expect(variance({ newFeeUgx: 9300 })).toMatchObject({
      ok: true,
      disposition: { kind: 'needs_agreement' },
    });
  });

  it('never asks the customer to agree a REDUCTION', () => {
    expect(variance({ newFeeUgx: 1000 })).toMatchObject({
      ok: true,
      disposition: { kind: 'absorbed', deltaUgx: -6500 },
    });
  });

  it('refuses to guess when the threshold is unset, rather than absorbing without limit', () => {
    expect(variance({ newFeeUgx: 50_000, threshold: { absoluteUgx: null, shareBps: null } })).toMatchObject({
      ok: false,
      refusal: 'THRESHOLD_NOT_CONFIGURED',
    });
  });

  it('reports no change as no change', () => {
    expect(variance({ newFeeUgx: 7500 })).toMatchObject({ ok: false, refusal: 'NO_CHANGE' });
  });
});

describe('the rider has no authority over the amount', () => {
  it('tells the rider exactly the order total, and nothing else', () => {
    expect(riderCollectionAmount({ paymentStatus: 'unpaid', totalUgx: 87_500 })).toEqual({
      collect: 87_500,
      label: 'COLLECT ON DELIVERY: UGX 87,500',
    });
  });

  it('collects nothing on a paid order', () => {
    expect(riderCollectionAmount({ paymentStatus: 'paid', totalUgx: 87_500 })).toEqual({
      collect: 0,
      label: 'PAID — collect nothing',
    });
  });

  it('takes no rider input at all — the strongest form the control can take', () => {
    // The function signature is the proof: there is no parameter a rider could
    // supply that would change the collected figure.
    expect(riderCollectionAmount.length).toBe(1);
  });
});

describe('the rider card is backed by the order total', () => {
  const root = resolve(__dirname, '../..');
  const card = readFileSync(resolve(root, 'apps/web/src/pages/admin/orders/[id].astro'), 'utf8');
  const order = readFileSync(resolve(root, 'apps/api/src/domain/commerce/Order.ts'), 'utf8');
  const checkout = readFileSync(resolve(root, 'apps/api/src/application/use-cases/commerce/CheckoutUseCase.ts'), 'utf8');

  it('renders the collected amount from the order total, server side', () => {
    expect(card).toContain('COLLECT ON DELIVERY');
    expect(card).toMatch(/order\.totalUgx/);
  });

  it('has no input, no form and no rider-editable field on the card', () => {
    const block = card.slice(card.indexOf('id="rider-card"'), card.indexOf('Purchased Products'));
    expect(block).not.toMatch(/<input|<form|contenteditable/i);
  });

  it('keeps the delivery fee INSIDE the total, which is what makes the promise true', () => {
    // fee -> pricing quote shippingUgx -> finalTotalUgx -> grossTotal -> total.
    // If this chain ever breaks, the rider under-collects by the delivery fee.
    expect(checkout).toContain('shippingUgx: fee.feeUgx');
    expect(order).toContain('pricingSnapshot?.finalTotalUgx ?? subtotal + deliveryFeeUgx');
    expect(order).toContain('const total = grossTotal - loyaltyDiscount');
  });
});

describe('quote caching', () => {
  const base = {
    configVersionId: null as string | null,
    originCode: 'HUB-CBD-WILSON',
    areaSlug: 'kampala-ntinda-10302',
    district: 'Kampala',
    goodsTotalUgx: 250_000,
    hasPin: false,
    eatHourOfWeek: 14,
  };

  it('gives the same basket the same key at product, cart and checkout', () => {
    expect(quoteCacheKey(base)).toBe(quoteCacheKey({ ...base }));
  });

  it('CHANGES when the configuration version changes — the thing that bites', () => {
    // Every cached CONFIG_INCOMPLETE must die the moment the numbers land.
    const before = quoteCacheKey({ ...base, configVersionId: null });
    const after = quoteCacheKey({ ...base, configVersionId: 'cfg-1' });
    expect(after).not.toBe(before);
    // And a later publish invalidates again, without any sweep.
    expect(quoteCacheKey({ ...base, configVersionId: 'cfg-2' })).not.toBe(after);
  });

  it('changes on every input that can move a fee', () => {
    const keys = new Set([
      quoteCacheKey(base),
      quoteCacheKey({ ...base, areaSlug: 'kampala-bukesa-10104' }),
      quoteCacheKey({ ...base, originCode: 'OTHER' }),
      quoteCacheKey({ ...base, goodsTotalUgx: 250_001 }),
      quoteCacheKey({ ...base, hasPin: true }),
      quoteCacheKey({ ...base, eatHourOfWeek: 15 }),
      quoteCacheKey({ ...base, district: 'Wakiso' }),
    ]);
    expect(keys.size).toBe(7);
  });

  it('has a canonical string that is reproducible when debugging', () => {
    expect(quoteCacheCanonicalString({ ...base, configVersionId: 'cfg-1' })).toBe(
      'v:cfg-1|o:HUB-CBD-WILSON|a:kampala-ntinda-10302|d:Kampala|g:250000|p:0|h:14',
    );
  });
});

describe('the free-delivery threshold ordering', () => {
  const amounts = { baseSubtotalUgx: 200_000, promotionDiscountUgx: 30_000, loyaltyDiscountUgx: 25_000 };

  it('defaults to after promotions, before loyalty', () => {
    expect(DEFAULT_THRESHOLD_ORDERING).toBe('after_promotions_before_loyalty');
    expect(thresholdBasisUgx('after_promotions_before_loyalty', amounts)).toBe(170_000);
  });

  it('implements all three orderings so the choice can change without a rewrite', () => {
    expect(thresholdBasisUgx('before_promotions', amounts)).toBe(200_000);
    expect(thresholdBasisUgx('after_promotions_before_loyalty', amounts)).toBe(170_000);
    expect(thresholdBasisUgx('after_loyalty', amounts)).toBe(145_000);
  });

  it('prevents the failure the ordering exists to prevent', () => {
    // Threshold 150,000. After promotions the customer is over it. Redeeming
    // points must NOT silently drop them back under.
    const chosen = qualifiesForFreeDelivery({
      ordering: 'after_promotions_before_loyalty',
      thresholdUgx: 150_000,
      ...amounts,
    });
    const alternative = qualifiesForFreeDelivery({ ordering: 'after_loyalty', thresholdUgx: 150_000, ...amounts });
    expect(chosen.qualifies).toBe(true);
    expect(alternative.qualifies).toBe(false); // the failure mode, made visible
  });

  it('treats an unset threshold as OFF, not as everything qualifying', () => {
    const r = qualifiesForFreeDelivery({
      ordering: DEFAULT_THRESHOLD_ORDERING,
      thresholdUgx: null,
      ...amounts,
    });
    expect(r.qualifies).toBe(false);
    expect(r.shortfallUgx).toBeNull();
  });

  it('reports an exact shortfall for the progress indicator', () => {
    const r = qualifiesForFreeDelivery({
      ordering: DEFAULT_THRESHOLD_ORDERING,
      thresholdUgx: 200_000,
      ...amounts,
    });
    expect(r.basisUgx).toBe(170_000);
    expect(r.shortfallUgx).toBe(30_000);
  });
});

describe('the same-day cutoff countdown, in East Africa Time', () => {
  it('is correct across a UTC day boundary', () => {
    // 21:30 UTC on the 5th is 00:30 EAT on the 6th. A 16:00 cutoff has not yet
    // passed on the 6th, so the countdown belongs to the 6th — not the 5th.
    const now = new Date('2026-08-05T21:30:00Z');
    const r = sameDayCutoff(now, '16:00')!;
    expect(eatDateString(now)).toBe('2026-08-06');
    expect(r.beforeCutoff).toBe(true);
    expect(r.eatDate).toBe('2026-08-06');
    expect(r.msRemaining).toBe(15.5 * 3_600_000);
  });

  it('is correct across a weekend boundary', () => {
    // Friday 21:30 UTC is already Saturday 00:30 in Kampala.
    const now = new Date('2026-08-07T21:30:00Z');
    expect(isEatWeekend(now)).toBe(true);
    expect(sameDayCutoff(now, '16:00')!.eatDate).toBe('2026-08-08');
  });

  it('never shows a negative countdown', () => {
    for (const hour of [0, 6, 12, 13, 14, 20, 23]) {
      const r = sameDayCutoff(new Date(`2026-08-05T${String(hour).padStart(2, '0')}:00:00Z`), '16:00')!;
      expect(r.msRemaining).toBeGreaterThan(0);
    }
  });
});

describe('reason routing to the right ops queue', () => {
  it('sends upcountry to manual quoting and unresolved to address review', () => {
    expect(MANUAL_QUOTE_REASONS).toContain('AREA_NOT_METRO');
    expect(ADDRESS_REVIEW_REASONS).toContain('AREA_UNRESOLVED');
    // Different work, different people — the two lists must not overlap.
    expect(MANUAL_QUOTE_REASONS.filter((r) => ADDRESS_REVIEW_REASONS.includes(r))).toEqual([]);
  });

  it('treats a district-only resolution as customer-actionable, not a refusal', () => {
    expect(UNAVAILABLE_REASONS).toContain('AREA_TOO_COARSE');
    expect(ADDRESS_REVIEW_REASONS).toContain('AREA_TOO_COARSE');
  });
});

describe('name collisions, one test per class', () => {
  const path = resolve(__dirname, '../../data/locations/v2/uganda_name_collisions.csv');
  const has = existsSync(path);
  const rows = has
    ? readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(1)
        .map((l) => {
          const c = l.split(',');
          return { type: c[0], name: c[1], districtWithName: c[2], areaSitsIn: c[3], slug: c[6] };
        })
    : [];

  it.skipIf(!has)('holds 84 collisions in the three declared classes', () => {
    expect(rows).toHaveLength(84);
    const byType = rows.reduce<Record<string, number>>((a, r) => ((a[r.type] = (a[r.type] ?? 0) + 1), a), {});
    expect(byType.AREA_NAME_MATCHES_OTHER_DISTRICT).toBe(38);
    expect(byType.SUBCOUNTY_NAME_MATCHES_OTHER_DISTRICT).toBe(18);
    expect(byType.AREA_NAME_MATCHES_OWN_DISTRICT).toBe(28);
  });

  it.skipIf(!has)('class 1: an area carrying another district’s name sits elsewhere', () => {
    const sample = rows.filter((r) => r.type === 'AREA_NAME_MATCHES_OTHER_DISTRICT');
    expect(sample.length).toBe(38);
    // The whole point: the name matches a district the area is NOT in. A bare
    // query for that name must resolve to the district, never to this area.
    for (const r of sample) expect(r.districtWithName).not.toBe(r.areaSitsIn);
  });

  it.skipIf(!has)('class 2: a sub-county carrying another district’s name', () => {
    const sample = rows.filter((r) => r.type === 'SUBCOUNTY_NAME_MATCHES_OTHER_DISTRICT');
    expect(sample.length).toBe(18);
    for (const r of sample) expect(r.districtWithName).not.toBe(r.areaSitsIn);
  });

  it.skipIf(!has)('class 3: an area sharing its OWN district’s name', () => {
    const sample = rows.filter((r) => r.type === 'AREA_NAME_MATCHES_OWN_DISTRICT');
    expect(sample.length).toBe(28);
    // Here the district IS the one it sits in — so the ambiguity is
    // district-versus-area, which is exactly what AREA_TOO_COARSE resolves.
    for (const r of sample) expect(r.districtWithName).toBe(r.areaSitsIn);
  });

  it.skipIf(!has)('includes the Kampala/Sembabule case that caused a real mis-route', () => {
    const kampala = rows.find((r) => r.name === 'Kampala');
    expect(kampala).toBeDefined();
    expect(kampala!.areaSitsIn).not.toBe('Kampala');
    expect(kampala!.slug).toMatch(/^sembabule-/);
  });
});
