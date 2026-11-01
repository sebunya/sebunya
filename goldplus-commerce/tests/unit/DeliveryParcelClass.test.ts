import { describe, it, expect } from 'vitest';
import {
  BasketLine,
  PARCEL_CAPACITY_KEYS,
  SHIPPING_CLASSES,
  capacitiesFromConfig,
  classRank,
  isShippingClass,
  parcelCountSentence,
  planParcels,
  resolveLineClass,
} from '../../apps/api/src/domain/delivery/DeliveryParcelClass';
import { DELIVERY_CONFIG_REGISTRY } from '../../apps/api/src/domain/delivery/DeliveryConfigRegistry';
import {
  ADDITIVE_PRIOR,
  NEUTRAL_PRIOR,
  describeFactor,
  factorFromRow,
  factorSampleSize,
  factorValue,
  fittedFactor,
  humanFactor,
  priorFactor,
} from '../../apps/api/src/domain/delivery/DeliveryLearnedFactor';

const line = (over: Partial<BasketLine> = {}): BasketLine => ({
  productId: 'p1',
  quantity: 1,
  productShippingClass: null,
  categoryShippingClass: null,
  productName: 'A cable',
  ...over,
});

describe('shipping class — resolved, never guessed', () => {
  it('prefers the product override over the category default', () => {
    const r = resolveLineClass(line({ productShippingClass: 'large', categoryShippingClass: 'small' }));
    expect(r).toMatchObject({ ok: true, shippingClass: 'large', source: 'product' });
  });

  it('falls through to the category default', () => {
    expect(resolveLineClass(line({ categoryShippingClass: 'medium' }))).toMatchObject({
      ok: true,
      shippingClass: 'medium',
      source: 'category',
    });
  });

  /**
   * The important one. Small is the CHEAPEST class, so defaulting to it would
   * systematically under-charge and the error would only surface when a carrier
   * refused the parcel at the counter.
   */
  it('NEVER defaults to small when nothing is set', () => {
    const r = resolveLineClass(line());
    expect(r.ok).toBe(false);
    const plan = planParcels([line()], {});
    expect(plan).toMatchObject({ ok: false, reason: 'PARCEL_CLASS_UNKNOWN' });
    if (plan.ok) return;
    expect(plan.unclassifiedProductIds).toEqual(['p1']);
    // And it names what an operator must go and set.
    expect(plan.detail).toContain('A cable');
    expect(plan.detail).toContain('category');
  });

  it('treats a stray value as unset rather than passing it through', () => {
    expect(isShippingClass('enormous')).toBe(false);
    expect(resolveLineClass(line({ productShippingClass: 'enormous' })).ok).toBe(false);
  });
});

describe('multi-item baskets — the highest class present, priced per parcel', () => {
  it('takes the highest class in the basket', () => {
    const plan = planParcels(
      [line({ productId: 'a', productShippingClass: 'small' }), line({ productId: 'b', productShippingClass: 'large' })],
      { large: 4 },
    );
    expect(plan).toMatchObject({ ok: true, shippingClass: 'large' });
    if (!plan.ok) return;
    expect(plan.classSetBy.productId).toBe('b');
  });

  it('orders the classes smallest first, so "highest" is a real comparison', () => {
    expect(classRank('small')).toBeLessThan(classRank('medium'));
    expect(classRank('medium')).toBeLessThan(classRank('large'));
  });

  it('splits into parcels and rounds UP — a part-full parcel is still a parcel', () => {
    const plan = planParcels([line({ productShippingClass: 'small', quantity: 7 })], { small: 3 });
    expect(plan).toMatchObject({ ok: true, parcelCount: 3, totalItems: 7 });
  });

  it('is exact at the capacity boundary', () => {
    expect(planParcels([line({ productShippingClass: 'small', quantity: 6 })], { small: 3 })).toMatchObject({ parcelCount: 2 });
    expect(planParcels([line({ productShippingClass: 'small', quantity: 3 })], { small: 3 })).toMatchObject({ parcelCount: 1 });
  });

  it('tells the customer the parcel count BEFORE they commit', () => {
    const plan = planParcels([line({ productShippingClass: 'small', quantity: 7 })], { small: 3 });
    if (!plan.ok) throw new Error('expected a plan');
    const sentence = parcelCountSentence(plan, 25_000);
    expect(sentence).toContain('3 parcels');
    expect(sentence).toContain('25,000');
    // Two parcels is two fees, and a surprise there is a dispute.
    expect(parcelCountSentence({ ...plan, parcelCount: 1 }, 25_000)).toContain('one parcel');
  });

  it('refuses to guess the number of FEES when capacity is unset', () => {
    const plan = planParcels([line({ productShippingClass: 'small', quantity: 4 })], {});
    expect(plan).toMatchObject({ ok: false, reason: 'PARCEL_CAPACITY_UNKNOWN' });
  });

  it('still answers for a single item with capacity unset — that is arithmetic', () => {
    // One item cannot exceed any capacity of one or more.
    expect(planParcels([line({ productShippingClass: 'medium', quantity: 1 })], {})).toMatchObject({
      ok: true,
      parcelCount: 1,
      capacityItems: null,
    });
  });

  it('refuses an empty basket rather than dividing by nothing', () => {
    expect(planParcels([], { small: 3 })).toMatchObject({ ok: false, reason: 'EMPTY_BASKET' });
    expect(planParcels([line({ productShippingClass: 'small', quantity: 0 })], { small: 3 })).toMatchObject({
      ok: false,
      reason: 'EMPTY_BASKET',
    });
  });

  it('guards a zero or negative capacity instead of dividing by it', () => {
    const plan = planParcels([line({ productShippingClass: 'small', quantity: 4 })], { small: 0 });
    expect(plan.ok).toBe(false);
    const negative = planParcels([line({ productShippingClass: 'small', quantity: 4 })], { small: -3 });
    expect(negative.ok).toBe(false);
  });

  it('declares all three capacities in the registry, all unset', () => {
    for (const cls of SHIPPING_CLASSES) {
      const entry = DELIVERY_CONFIG_REGISTRY.find((e) => e.key === PARCEL_CAPACITY_KEYS[cls]);
      expect(entry, PARCEL_CAPACITY_KEYS[cls]).toBeTruthy();
      expect(entry!.defaultValue).toBeNull();
      expect(entry!.tier).toBe(1);
    }
    expect(capacitiesFromConfig({})).toEqual({ small: null, medium: null, large: null });
    expect(capacitiesFromConfig({ parcel_capacity_small_items: 4 }).small).toBe(4);
  });
});

describe('learned factors — unlearned and fitted are different TYPES', () => {
  it('a prior carries no value to read at all', () => {
    const p = priorFactor(NEUTRAL_PRIOR);
    expect('value' in p).toBe(false);
    expect(factorValue(p)).toBe(1);
    expect(factorSampleSize(p)).toBe(0);
  });

  /**
   * The defect this file exists to make impossible: a "fitted" factor with no
   * sample. `fittedFactor` refuses it and hands back a prior.
   */
  it('refuses to build a fitted factor from a zero sample', () => {
    expect(fittedFactor({ value: 1.4, sampleSize: 0, prior: 1 }).kind).toBe('prior');
    expect(fittedFactor({ value: 1.4, sampleSize: -2, prior: 1 }).kind).toBe('prior');
    expect(fittedFactor({ value: Number.NaN, sampleSize: 50, prior: 1 }).kind).toBe('prior');
    expect(fittedFactor({ value: 1.4, sampleSize: 1, prior: 1 }).kind).toBe('fitted');
  });

  it('never displays a fitted 1.0 the same as an unlearned 1.0', () => {
    const unlearned = describeFactor(priorFactor(NEUTRAL_PRIOR));
    const measured = describeFactor(fittedFactor({ value: 1, sampleSize: 40, prior: 1 }));
    expect(unlearned.effectiveValue).toBe(measured.effectiveValue);
    expect(unlearned.state).toBe('not_learned');
    expect(measured.state).toBe('fitted');
    expect(unlearned.learnedValue).toBeNull();
    expect(measured.learnedValue).toBe(1);
    expect(unlearned.label).toContain('Not learned');
    expect(measured.label).toContain('40');
  });

  it('reads the contradiction the database can still express as a prior', () => {
    // origin='fitted' with sample_size=0 is a bug in whatever wrote it. Nothing
    // was learned, so a prior is both the safe reading and the true one.
    const f = factorFromRow({ origin: 'fitted', value: '1.4000', sampleSize: 0 }, 1);
    expect(f.kind).toBe('prior');
    expect(factorValue(f)).toBe(1);
  });

  it('reads a genuine fit as fitted, and a human value as human', () => {
    expect(factorFromRow({ origin: 'fitted', value: '1.4000', sampleSize: 12 }, 1)).toMatchObject({
      kind: 'fitted',
      value: 1.4,
      sampleSize: 12,
    });
    const h = factorFromRow({ origin: 'human', value: '1.2', sampleSize: null, setBy: 'ops' }, 1);
    expect(h).toMatchObject({ kind: 'human', value: 1.2 });
    // A human override carries no sample, because a person is not a measurement.
    expect(factorSampleSize(h)).toBe(0);
    expect(describeFactor(h).state).toBe('set_by_hand');
  });

  it('keeps the additive prior distinct from the multiplicative one', () => {
    // last_mile is ADDED minutes, so its prior is zero, not one. The old shared
    // `{value:1,sampleSize:0}` shape let an additive factor be handed a
    // multiplicative neutral and only computed correctly by accident.
    expect(factorValue(priorFactor(ADDITIVE_PRIOR))).toBe(0);
    expect(factorValue(priorFactor(NEUTRAL_PRIOR))).toBe(1);
  });

  it('a human factor with a non-finite value falls back to the prior', () => {
    expect(humanFactor({ value: Number.NaN, setBy: 'ops', prior: 1 }).kind).toBe('prior');
  });
});
