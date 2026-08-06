import { describe, it, expect } from 'vitest';
import {
  FULFILMENT_MODES,
  isWithinRiderRange,
  resolveFulfilmentMode,
} from '../../apps/api/src/domain/delivery/DeliveryFulfilmentMode';
import {
  ADDITIVE_NEUTRAL_FACTOR,
  AreaInput,
  NEUTRAL_FACTOR,
  QuoteInputs,
  UNAVAILABLE_REASONS,
  REASON_COPY_KEY,
  narrowToOwnRider,
  quoteDelivery,
} from '../../apps/api/src/domain/delivery/DeliveryModel';
import { quoteFulfilment, mayBeDefaultOption } from '../../apps/api/src/domain/delivery/DeliveryQuoteService';
import {
  BusRateCard,
  isCardCurrent,
  selectRateCard,
  buildShipmentQuote,
  shipmentSummary,
} from '../../apps/api/src/domain/delivery/DeliveryBusRateCard';
import { assessProportionality } from '../../apps/api/src/domain/delivery/DeliveryProportionality';
import { DELIVERY_CONFIG_REGISTRY, validateConfigValue } from '../../apps/api/src/domain/delivery/DeliveryConfigRegistry';

const CONFIG = {
  effective_speed_kmh: 18.6667,
  rider_cost_per_minute_ugx: 111.1111,
  handling_minutes: 15,
  margin_multiplier: 1.3,
  minimum_fee_ugx: 3000,
  fee_rounding_step_ugx: 500,
};

const area = (over: Partial<AreaInput> = {}): AreaInput => ({
  areaSlug: 'kampala-ntinda-10101',
  district: 'Kampala',
  corridor: 'kira_rd',
  band: 'B2',
  accessMode: 'road',
  serviceable: true,
  measuredKm: null,
  centroidSource: null,
  ...over,
});

const riderBase = (): Omit<QuoteInputs, 'area'> => ({
  config: CONFIG,
  hasActiveOrigin: true,
  originCode: 'HUB-CBD-WILSON',
  corridorFactor: NEUTRAL_FACTOR,
  hourFactor: NEUTRAL_FACTOR,
  detourFactor: NEUTRAL_FACTOR,
  lastMileMinutes: ADDITIVE_NEUTRAL_FACTOR,
  areaSampleSize: 0,
  observedMinutes: null,
  onTimeTargetBps: null,
  windowMinSampleSize: null,
  configVersionId: 'v1',
});

const busBase = (over: Partial<Parameters<typeof quoteFulfilment>[0]['bus']> = {}) => ({
  cards: [] as BusRateCard[],
  office: null,
  parcels: { ok: true as const, shippingClass: 'small' as const, totalItems: 1, capacityItems: null, parcelCount: 1, classSetBy: { productId: 'p', source: 'product' as const } },
  destinationTown: 'Arua',
  destinationDistrict: 'Arua',
  at: new Date('2026-08-06T09:00:00Z'),
  declaredValueUgx: null,
  ...over,
});

const card = (over: Partial<BusRateCard> = {}): BusRateCard => ({
  id: 'card-1',
  carrier: 'Gaagaa',
  destinationTown: 'Arua',
  destinationDistrict: 'Arua',
  parcelClass: 'small',
  feeUgx: 25_000,
  insurancePctOfDeclaredValue: 1,
  transitDaysMin: 1,
  transitDaysMax: 2,
  chargedAt: 'collection',
  effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  effectiveTo: null,
  version: 1,
  ...over,
});

const quote = (over: Partial<Parameters<typeof quoteFulfilment>[0]> = {}) =>
  quoteFulfilment({
    area: area(),
    mode: 'own_rider',
    rider: riderBase(),
    bus: busBase(),
    subtotalUgx: 200_000,
    proportionality: { feeToValueRatioCeiling: null, minOrderValueUgx: {}, freeDeliveryThresholdUgx: null },
    ...over,
  });

describe('fulfilment mode — the fact the model had wrong', () => {
  it('classifies an upcountry area as bus, not as "not metro"', () => {
    // Arua has no corridor row at all. Telling that customer where they are NOT
    // is accurate and useless; they are served, by bus.
    const mode = resolveFulfilmentMode({ corridor: null, band: null, accessMode: null, serviceable: true }, 'B3');
    expect(mode).toBe('bus_parcel');
  });

  it('classifies a metro area beyond the rider ceiling as bus', () => {
    // B6 is a 6.4 hour round trip. That is not a delivery.
    expect(resolveFulfilmentMode({ corridor: 'masaka_rd', band: 'B6', accessMode: 'road', serviceable: true }, 'B3')).toBe(
      'bus_parcel',
    );
  });

  it('classifies a metro area inside the ceiling as own rider', () => {
    expect(resolveFulfilmentMode({ corridor: 'kira_rd', band: 'B2', accessMode: 'road', serviceable: true }, 'B3')).toBe(
      'own_rider',
    );
  });

  it('treats the ceiling band itself as inside rider range', () => {
    expect(isWithinRiderRange('B3', 'B3')).toBe(true);
    expect(isWithinRiderRange('B4', 'B3')).toBe(false);
  });

  it('water beats the band — the 12 lake areas stay pickup only', () => {
    expect(resolveFulfilmentMode({ corridor: 'lake_victoria', band: 'B5', accessMode: 'water', serviceable: true }, 'B6')).toBe(
      'pickup_only',
    );
  });

  it('unserviceable beats everything except an explicit override', () => {
    expect(resolveFulfilmentMode({ corridor: 'cbd', band: 'B0', accessMode: 'road', serviceable: false }, 'B6')).toBe(
      'unserviceable',
    );
  });

  it("an operator's explicit mode always wins over the derivation", () => {
    const mode = resolveFulfilmentMode(
      { corridor: 'kira_rd', band: 'B2', accessMode: 'road', serviceable: true, declaredMode: 'bus_parcel' },
      'B6',
    );
    expect(mode).toBe('bus_parcel');
  });

  /**
   * The important one. An unset ceiling means we do not KNOW where rider
   * service ends, and the honest consequence is that nothing is own_rider —
   * not that everything is.
   */
  it('classifies nothing as own rider while the ceiling is unset', () => {
    expect(resolveFulfilmentMode({ corridor: 'cbd', band: 'B0', accessMode: 'road', serviceable: true }, null)).toBeNull();
    // ...but the facts that do not depend on the ceiling are still known.
    expect(resolveFulfilmentMode({ corridor: null, band: null, accessMode: null, serviceable: true }, null)).toBe('bus_parcel');
    expect(resolveFulfilmentMode({ corridor: 'lake_victoria', band: 'B5', accessMode: 'water', serviceable: true }, null)).toBe(
      'pickup_only',
    );
  });
});

describe('computed pricing is UNREACHABLE outside own-rider range', () => {
  /**
   * The brief: "the computed minutes model must be structurally unable to
   * produce a fee, not merely discouraged from doing so. Delete the code path
   * rather than guarding it, and add a test that a bus_parcel area cannot
   * return a computed quote no matter what is configured."
   *
   * This is that test. It tries every configuration that could plausibly coax a
   * number out of the model and gets none.
   */
  it('a bus_parcel area cannot return a computed quote, whatever is configured', () => {
    const busArea = area({ band: 'B6', corridor: 'masaka_rd', fulfilmentMode: 'bus_parcel' });

    // 1. The narrowing function refuses it, which is the only way in.
    expect(narrowToOwnRider(busArea)).toBeNull();

    // 2. Every configuration shape, including deliberately absurd ones.
    const configs = [
      CONFIG,
      { ...CONFIG, minimum_fee_ugx: 1_000_000 },
      { ...CONFIG, margin_multiplier: 10 },
      { ...CONFIG, effective_speed_kmh: 1 },
      { ...CONFIG, effective_speed_kmh: 120 },
      {},
    ];
    for (const config of configs) {
      const result = quoteFulfilment({
        area: busArea,
        mode: 'bus_parcel',
        rider: { ...riderBase(), config: config as QuoteInputs['config'] },
        // No rate card either, so there is no bus fee to fall back on.
        bus: busBase({ cards: [] }),
        subtotalUgx: 200_000,
        proportionality: { feeToValueRatioCeiling: null, minOrderValueUgx: {}, freeDeliveryThresholdUgx: null },
      });
      expect(result.kind).toBe('unavailable');
      if (result.kind !== 'unavailable') continue;
      expect(result.reason).toBe('NO_RATE_CARD');
      // And critically: no computed minutes leaked into the explanation.
      expect(result.explanation.expectedMinutes).toBeNull();
      expect(result.explanation.rawFeeUgx).toBeNull();
    }
  });

  it('the 56,000 six-hour round trip can no longer be computed', () => {
    // B6 with a B3 ceiling. Previously this produced UGX 56,000 for 385
    // minutes. Now the computed model cannot be asked.
    const result = quote({
      area: area({ band: 'B6', corridor: 'masaka_rd' }),
      mode: resolveFulfilmentMode({ corridor: 'masaka_rd', band: 'B6', accessMode: 'road', serviceable: true }, 'B3'),
    });
    expect(result.kind).toBe('unavailable');
    if (result.kind !== 'unavailable') return;
    expect(result.mode).toBe('bus_parcel');
    expect(result.explanation.expectedMinutes).toBeNull();
  });

  it('a pickup-only area cannot reach the computed model either', () => {
    const result = quote({ area: area({ accessMode: 'water' }), mode: 'pickup_only' });
    expect(result).toMatchObject({ kind: 'unavailable', reason: 'WATER_ACCESS' });
  });

  it('an unserviceable area cannot reach the computed model either', () => {
    const result = quote({ area: area({ serviceable: false }), mode: 'unserviceable' });
    expect(result).toMatchObject({ kind: 'unavailable', reason: 'AREA_UNSERVICEABLE' });
  });

  it('an unset rider ceiling names the key rather than assuming a value', () => {
    const result = quote({ mode: null });
    expect(result.kind).toBe('unavailable');
    if (result.kind !== 'unavailable') return;
    expect(result.reason).toBe('CONFIG_INCOMPLETE');
    expect(result.missingConfigKeys).toContain('own_rider_max_band');
  });

  it('still prices an own-rider destination normally', () => {
    const result = quote();
    expect(result.kind).toBe('rider_delivery');
    if (result.kind !== 'rider_delivery') return;
    expect(result.feeUgx).toBe(9000);
    expect(result.expectedMinutes).toBeCloseTo(60, 3);
  });

  it('the computed model itself has no mode branches left to take', () => {
    // Direct call, bypassing the service: even here there is no bus, water or
    // unserviceable path — the type will not carry one.
    const source = quoteDelivery.toString();
    expect(source).not.toContain('WATER_ACCESS');
    expect(source).not.toContain('AREA_UNSERVICEABLE');
    expect(source).not.toContain('AREA_NOT_METRO');
    expect(source).not.toContain('CARRIER_REQUIRED');
  });
});

describe('bus rate cards — negotiated, never modelled', () => {
  it('prices from an exact destination and class', () => {
    const r = selectRateCard([card()], {
      destinationTown: 'Arua',
      destinationDistrict: 'Arua',
      parcelClass: 'small',
      at: new Date('2026-08-06T00:00:00Z'),
    });
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.card.feeUgx).toBe(25_000);
  });

  it('NEVER borrows a neighbouring town’s fee', () => {
    const r = selectRateCard([card({ destinationTown: 'Nebbi', destinationDistrict: 'Nebbi' })], {
      destinationTown: 'Arua',
      destinationDistrict: 'Arua',
      parcelClass: 'small',
      at: new Date('2026-08-06T00:00:00Z'),
    });
    expect(r).toMatchObject({ ok: false, reason: 'NO_CARD_FOR_DESTINATION' });
  });

  it('NEVER interpolates a missing parcel class from the one above or below', () => {
    const r = selectRateCard([card({ parcelClass: 'small' }), card({ id: 'c3', parcelClass: 'large', feeUgx: 60_000 })], {
      destinationTown: 'Arua',
      destinationDistrict: 'Arua',
      parcelClass: 'medium',
      at: new Date('2026-08-06T00:00:00Z'),
    });
    expect(r).toMatchObject({ ok: false, reason: 'NO_CARD_FOR_PARCEL_CLASS' });
  });

  it('an expired card is never used as a fallback', () => {
    const expired = card({ effectiveTo: new Date('2026-06-30T00:00:00Z') });
    expect(isCardCurrent(expired, new Date('2026-08-06T00:00:00Z'))).toBe(false);
    const r = selectRateCard([expired], {
      destinationTown: 'Arua',
      destinationDistrict: 'Arua',
      parcelClass: 'small',
      at: new Date('2026-08-06T00:00:00Z'),
    });
    expect(r).toMatchObject({ ok: false, reason: 'ALL_CARDS_EXPIRED' });
  });

  it('a card not yet in force is not used early', () => {
    const future = card({ effectiveFrom: new Date('2026-12-01T00:00:00Z') });
    expect(isCardCurrent(future, new Date('2026-08-06T00:00:00Z'))).toBe(false);
  });

  it('the cheapest current card wins, ties breaking on the later version', () => {
    const r = selectRateCard(
      [
        card({ id: 'a', carrier: 'Gaagaa', feeUgx: 30_000 }),
        card({ id: 'b', carrier: 'Link', feeUgx: 25_000 }),
        card({ id: 'c', carrier: 'Link', feeUgx: 25_000, version: 2 }),
      ],
      { destinationTown: 'Arua', destinationDistrict: 'Arua', parcelClass: 'small', at: new Date('2026-08-06T00:00:00Z') },
    );
    if (!r.ok) throw new Error('expected a card');
    expect(r.card.id).toBe('c');
  });

  /**
   * RETIRED 2026-08-06: the weight-band tests are gone with the weight system.
   * Weights were never in the catalogue, so every basket resolved to
   * WEIGHT_UNKNOWN — a data system nobody was going to populate. Shipping class
   * is now a property of the goods; see DeliveryParcelClass.test.ts.
   */
  it('prices per PARCEL, because a bus office counts parcels', () => {
    const result = quote({
      area: area({ corridor: null, band: null, accessMode: null, district: 'Arua' }),
      mode: 'bus_parcel',
      bus: busBase({
        cards: [card()],
        parcels: { ok: true, shippingClass: 'small', totalItems: 7, capacityItems: 3, parcelCount: 3, classSetBy: { productId: 'p', source: 'product' } },
      }),
    });
    expect(result.kind).toBe('bus_shipment');
    if (result.kind !== 'bus_shipment') return;
    expect(result.perParcelFeeUgx).toBe(25_000);
    expect(result.parcelCount).toBe(3);
    expect(result.feeUgx).toBe(75_000);
    // And the customer is TOLD, before committing. Two parcels is two fees.
    expect(result.parcelSentence).toContain('3 parcels');
  });

  it('refuses rather than guessing a shipping class', () => {
    const result = quote({
      area: area({ corridor: null, band: null, accessMode: null, district: 'Arua' }),
      mode: 'bus_parcel',
      bus: busBase({
        cards: [card()],
        parcels: { ok: false, reason: 'PARCEL_CLASS_UNKNOWN', detail: 'no class', unclassifiedProductIds: ['p'] },
      }),
    });
    expect(result).toMatchObject({ kind: 'unavailable', reason: 'PARCEL_CLASS_UNKNOWN' });
  });

  it('insurance with no declared value is null, not zero', () => {
    const q = buildShipmentQuote({ card: card(), office: null, declaredValueUgx: null });
    expect(q.insuranceUgx).toBeNull();
    const withValue = buildShipmentQuote({ card: card(), office: null, declaredValueUgx: 200_000 });
    expect(withValue.insuranceUgx).toBe(2000);
  });

  it('a carrier offering no cover is distinguishable from zero percent cover', () => {
    const none = buildShipmentQuote({ card: card({ insurancePctOfDeclaredValue: null }), office: null, declaredValueUgx: 200_000 });
    const zero = buildShipmentQuote({ card: card({ insurancePctOfDeclaredValue: 0 }), office: null, declaredValueUgx: 200_000 });
    expect(none.insuranceUgx).toBeNull();
    expect(zero.insuranceUgx).toBe(0);
  });

  it('the customer sentence says shipment and collection, never delivery to the door', () => {
    const q = buildShipmentQuote({ card: card(), office: null, declaredValueUgx: null });
    const text = shipmentSummary(q);
    expect(text).toContain('collect');
    expect(text.toLowerCase()).not.toContain('to your door');
    expect(text.toLowerCase()).not.toContain('deliver');
  });

  it('records which carrier and card version priced it, so a dispute is reproducible', () => {
    const q = buildShipmentQuote({ card: card({ version: 4 }), office: null, declaredValueUgx: null });
    expect(q.carrier).toBe('Gaagaa');
    expect(q.rateCardId).toBe('card-1');
    expect(q.rateCardVersion).toBe(4);
  });
});

describe('the one quoting service dispatches on mode', () => {
  it('returns a bus shipment when a current card exists', () => {
    const result = quote({
      area: area({ corridor: null, band: null, accessMode: null, district: 'Arua' }),
      mode: 'bus_parcel',
      bus: busBase({ cards: [card()] }),
    });
    expect(result.kind).toBe('bus_shipment');
    if (result.kind !== 'bus_shipment') return;
    expect(result.feeUgx).toBe(25_000);
    expect(result.shipment.carrier).toBe('Gaagaa');
  });

  it('returns NO_RATE_CARD when the destination is bus-served and unpriced', () => {
    const result = quote({
      area: area({ corridor: null, band: null, accessMode: null, district: 'Arua' }),
      mode: 'bus_parcel',
      bus: busBase({ cards: [] }),
    });
    expect(result).toMatchObject({ kind: 'unavailable', reason: 'NO_RATE_CARD', mode: 'bus_parcel' });
  });

  it('a district-only resolution is still AREA_TOO_COARSE, before mode is even asked', () => {
    const result = quote({ area: area({ districtOnly: true }), mode: null });
    expect(result).toMatchObject({ kind: 'unavailable', reason: 'AREA_TOO_COARSE' });
  });

  it('an unresolved address is still first in the order', () => {
    expect(quote({ area: null, mode: null })).toMatchObject({ kind: 'unavailable', reason: 'AREA_UNRESOLVED' });
  });
});

describe('proportionality — the fee never quietly exceeds the goods', () => {
  it('flags a 35,000 delivery on a 20,000 basket', () => {
    const r = assessProportionality({
      feeUgx: 35_000,
      subtotalUgx: 20_000,
      mode: 'own_rider',
      config: { feeToValueRatioCeiling: 0.5, minOrderValueUgx: {}, freeDeliveryThresholdUgx: null },
    });
    const finding = r.findings.find((f) => f.kind === 'fee_exceeds_value');
    expect(finding).toBeTruthy();
    if (finding?.kind !== 'fee_exceeds_value') return;
    // 35,000 / 0.5 = 70,000 basket makes it proportionate.
    expect(finding.proportionateAtUgx).toBe(70_000);
    expect(finding.addToReachProportionateUgx).toBe(50_000);
    expect(r.requiresAcknowledgement).toBe(true);
  });

  it('shows the free-delivery threshold as the constructive alternative', () => {
    const r = assessProportionality({
      feeUgx: 35_000,
      subtotalUgx: 20_000,
      mode: 'own_rider',
      config: { feeToValueRatioCeiling: 0.5, minOrderValueUgx: {}, freeDeliveryThresholdUgx: 150_000 },
    });
    const f = r.findings[0];
    if (f.kind !== 'fee_exceeds_value') throw new Error('expected the ratio finding');
    expect(f.freeDeliveryAtUgx).toBe(150_000);
    expect(f.addToReachFreeUgx).toBe(130_000);
  });

  it('does nothing at all while the ceiling is unset', () => {
    const r = assessProportionality({
      feeUgx: 35_000,
      subtotalUgx: 20_000,
      mode: 'own_rider',
      config: { feeToValueRatioCeiling: null, minOrderValueUgx: {}, freeDeliveryThresholdUgx: null },
    });
    expect(r.findings).toEqual([]);
    expect(r.requiresAcknowledgement).toBe(false);
  });

  it('never divides by a zero subtotal', () => {
    const r = assessProportionality({
      feeUgx: 35_000,
      subtotalUgx: 0,
      mode: 'own_rider',
      config: { feeToValueRatioCeiling: 0.5, minOrderValueUgx: {}, freeDeliveryThresholdUgx: null },
    });
    expect(r.findings.some((f) => f.kind === 'fee_exceeds_value')).toBe(false);
    for (const f of r.findings) if (f.kind === 'fee_exceeds_value') expect(Number.isFinite(f.ratio)).toBe(true);
  });

  it('reports a basket below the per-mode minimum without demanding a tick', () => {
    const r = assessProportionality({
      feeUgx: 25_000,
      subtotalUgx: 15_000,
      mode: 'bus_parcel',
      config: { feeToValueRatioCeiling: null, minOrderValueUgx: { bus_parcel: 50_000 }, freeDeliveryThresholdUgx: null },
    });
    const f = r.findings[0];
    expect(f.kind).toBe('below_minimum_order');
    if (f.kind !== 'below_minimum_order') return;
    expect(f.shortfallUgx).toBe(35_000);
    // Informative, not a gate. Making someone tick a box because their order is
    // small would be a dark pattern.
    expect(r.requiresAcknowledgement).toBe(false);
  });

  it('a minimum for one mode does not apply to another', () => {
    const r = assessProportionality({
      feeUgx: 9000,
      subtotalUgx: 15_000,
      mode: 'own_rider',
      config: { feeToValueRatioCeiling: null, minOrderValueUgx: { bus_parcel: 50_000 }, freeDeliveryThresholdUgx: null },
    });
    expect(r.findings).toEqual([]);
  });

  it('a disproportionate quote is never the default option, but is still available', () => {
    const result = quote({
      subtotalUgx: 10_000,
      proportionality: { feeToValueRatioCeiling: 0.5, minOrderValueUgx: {}, freeDeliveryThresholdUgx: null },
    });
    expect(result.kind).toBe('rider_delivery');
    // Available — the sale is never blocked...
    if (result.kind !== 'rider_delivery') return;
    expect(result.feeUgx).toBe(9000);
    // ...but not pre-selected.
    expect(mayBeDefaultOption(result)).toBe(false);
  });

  it('a proportionate quote may be the default', () => {
    expect(mayBeDefaultOption(quote())).toBe(true);
  });
});

describe('registry and reason bookkeeping', () => {
  it('every reason has a copy key and every copy key is a registry entry', () => {
    const keys = new Set(DELIVERY_CONFIG_REGISTRY.map((e) => e.key));
    for (const reason of UNAVAILABLE_REASONS) {
      const key = REASON_COPY_KEY[reason];
      expect(key, `${reason} has no copy key`).toBeTruthy();
      expect(keys.has(key), `${key} is not in the registry`).toBe(true);
    }
  });

  it('the two new reasons are in the closed list', () => {
    expect(UNAVAILABLE_REASONS).toContain('CARRIER_REQUIRED');
    expect(UNAVAILABLE_REASONS).toContain('NO_RATE_CARD');
  });

  it('own_rider_max_band accepts only a real band', () => {
    expect(validateConfigValue('own_rider_max_band', 'B3')).toMatchObject({ ok: true });
    expect(validateConfigValue('own_rider_max_band', 'B9')).toMatchObject({ ok: false });
    expect(validateConfigValue('own_rider_max_band', 'CORE')).toMatchObject({ ok: false });
  });

  it('own_rider_max_band is mandatory, Tier 2, and ships unset', () => {
    const entry = DELIVERY_CONFIG_REGISTRY.find((e) => e.key === 'own_rider_max_band')!;
    expect(entry.mandatory).toBe(true);
    expect(entry.tier).toBe(2);
    expect(entry.defaultValue).toBeNull();
  });

  it('the proportionality thresholds all ship unset, so nothing changes until set', () => {
    for (const key of [
      'fee_to_value_ratio_ceiling',
      'min_order_value_own_rider_ugx',
      'min_order_value_bus_parcel_ugx',
    ]) {
      expect(DELIVERY_CONFIG_REGISTRY.find((e) => e.key === key)!.defaultValue, key).toBeNull();
    }
  });

  it('the four fulfilment modes are a closed set', () => {
    expect([...FULFILMENT_MODES].sort()).toEqual(['bus_parcel', 'own_rider', 'pickup_only', 'unserviceable']);
  });
});
