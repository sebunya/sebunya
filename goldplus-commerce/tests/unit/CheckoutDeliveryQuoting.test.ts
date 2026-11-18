import { afterEach, describe, expect, it, vi } from 'vitest';
import { toEatParts } from '@goldplus/shared';
import {
  buildCheckoutDeliveryQuoting,
  type CheckoutDeliveryQuotingPorts,
} from '../../apps/api/src/application/use-cases/delivery/CheckoutDeliveryQuoting';
import { resetAppLogger, setAppLogger } from '../../apps/api/src/application/logging/appLogger';
// Loaded at collection time, as the other real-Registry tests do: building it takes longer than one test's budget.
import { Registry } from '../../apps/api/src/infrastructure/Registry';

/**
 * The delivery adapter checkout and the delivery estimate charge through (moved
 * out of the Registry, 2026-11). Until the move it was pinned only by matching
 * Registry source text.
 */

const NOW = new Date('2026-11-11T09:30:00.000Z');
const ITEMS = [{ productId: 'p-1', quantity: 2 }];

function explanation(overrides: Record<string, unknown> = {}) {
  return {
    areaSlug: 'ntinda',
    corridor: 'east',
    band: 'B2',
    centroidSource: 'curated',
    accuracyTier: 'area',
    centroidKm: 7.4,
    centroidExpectedErrorM: 900,
    distanceSource: 'centroid',
    configVersionId: 'cfg-12',
    oneWayKm: 6.5,
    ...overrides,
  };
}

const RIDER = {
  quote: { kind: 'rider_delivery', mode: 'own_rider', feeUgx: 8_000, expectedMinutes: 55, explanation: explanation() },
  resolved: { aliasUsed: 'Ntinda Trading Centre' },
  pricedBy: 'delivery_model',
  mayFallBackToLegacy: false,
  freeDeliveryThresholdUgx: 300_000,
};

function harness(outcome: unknown = RIDER, points: unknown[] = []) {
  const ports = {
    managePickupPointsUseCase: { list: vi.fn(async () => points) },
    deliveryQuotingUseCase: { execute: vi.fn(async () => outcome) },
    deliveryCaptureRepo: { upsert: vi.fn(async () => ({})) },
  };
  return { ports, adapter: buildCheckoutDeliveryQuoting(ports as unknown as CheckoutDeliveryQuotingPorts) };
}

afterEach(() => {
  vi.useRealTimers();
  resetAppLogger();
});

describe('collecting from one of our shops', () => {
  const SHOP = { id: 'pp-shop', active: true, operator: 'goldplus' };

  it('is free, confirmed and never quoted', async () => {
    const h = harness(RIDER, [SHOP]);
    await expect(h.adapter.quote({ items: ITEMS, pickupPointId: 'pp-shop' })).resolves.toEqual({
      feeUgx: 0,
      freeDeliveryThresholdUgx: null,
      feeBeforeFreeDeliveryUgx: 0,
      confirmed: true,
      pricedBy: 'manual',
      mayFallBackToLegacy: false,
      capture: { fulfilmentMode: 'pickup_only', pricedBy: 'manual', quotedFeeUgx: 0 },
    });
    expect(h.ports.deliveryQuotingUseCase.execute).not.toHaveBeenCalled();
  });

  it('refuses a point that is unknown, inactive or a carrier office (never a free pickup)', async () => {
    for (const points of [[], [{ ...SHOP, active: false }], [{ ...SHOP, operator: 'bus_parcel_office' }], [{ ...SHOP, operator: '' }]]) {
      const h = harness(RIDER, points);
      await expect(h.adapter.quote({ items: ITEMS, pickupPointId: 'pp-shop' })).rejects.toThrow(/^PICKUP_POINT_UNAVAILABLE: /);
      expect(h.ports.deliveryQuotingUseCase.execute).not.toHaveBeenCalled();
    }
  });
});

describe('a delivered order', () => {
  it('charges the rider fee and records the capture at the instant it quoted', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const h = harness();
    const input = { items: ITEMS, areaSlug: 'ntinda', district: 'Kampala', point: null };
    const result = await h.adapter.quote(input);
    expect(h.ports.deliveryQuotingUseCase.execute).toHaveBeenCalledWith({ ...input, at: NOW });
    const eat = toEatParts(NOW);
    expect(result).toEqual({
      feeUgx: 8_000,
      paidAtCollectionUgx: null,
      freeDeliveryThresholdUgx: 300_000,
      feeBeforeFreeDeliveryUgx: 8_000,
      confirmed: true,
      pricedBy: 'delivery_model',
      mayFallBackToLegacy: false,
      unavailableReason: null,
      capture: {
        areaSlug: 'ntinda',
        corridor: 'east',
        distanceBand: 'B2',
        quotedFeeUgx: 8_000,
        expectedMinutes: 55,
        centroidSource: 'curated',
        accuracyTier: 'area',
        centroidKm: 7.4,
        centroidExpectedErrorM: 900,
        distanceSource: 'centroid',
        configVersionId: 'cfg-12',
        aliasUsed: 'Ntinda Trading Centre',
        eatHourOfWeek: eat.weekday * 24 + eat.hour,
        straightLineKm: 13,
        fulfilmentMode: 'own_rider',
        carrier: null,
        rateCardId: null,
        rateCardVersion: null,
        parcelClass: null,
        parcelCount: null,
        perParcelFeeUgx: null,
        unavailableReason: null,
      },
    });
  });

  it('reports the fee a free-delivery waiver removed', async () => {
    const waived = { ...RIDER, quote: { ...RIDER.quote, feeUgx: 0, freeDelivery: { thresholdUgx: 300_000, basisUgx: 320_000, waivedFeeUgx: 8_000 } } };
    const result = await harness(waived).adapter.quote({ items: ITEMS });
    expect(result.feeUgx).toBe(0);
    expect(result.feeBeforeFreeDeliveryUgx).toBe(8_000);
  });

  it('stores a district-only resolution (empty slug) as no area, and no straight line when distance is unknown', async () => {
    const outcome = { ...RIDER, resolved: null, quote: { ...RIDER.quote, explanation: explanation({ areaSlug: '', oneWayKm: null }) } };
    const { capture } = await harness(outcome).adapter.quote({ items: ITEMS });
    expect(capture).toMatchObject({ areaSlug: null, straightLineKm: null, aliasUsed: null });
  });
});

describe('an upcountry bus shipment', () => {
  const shipment = (chargedAt: 'collection' | 'checkout') => ({
    ...RIDER,
    pricedBy: 'bus_rate_card',
    quote: {
      kind: 'bus_shipment',
      mode: 'bus_parcel',
      feeUgx: 30_000,
      perParcelFeeUgx: 15_000,
      parcelCount: 2,
      shipment: { carrier: 'link_bus', rateCardId: 'rc-3', rateCardVersion: 4, parcelClass: 'small', chargedAt },
      explanation: explanation(),
    },
  });

  it('paid at the parcel office: the order charges nothing and says what is paid there', async () => {
    const result = await harness(shipment('collection')).adapter.quote({ items: ITEMS });
    expect(result).toMatchObject({ feeUgx: 0, paidAtCollectionUgx: 30_000, feeBeforeFreeDeliveryUgx: 0, confirmed: true });
    expect(result.capture).toMatchObject({
      quotedFeeUgx: 0, expectedMinutes: null, fulfilmentMode: 'bus_parcel', carrier: 'link_bus',
      rateCardId: 'rc-3', rateCardVersion: 4, parcelClass: 'small', parcelCount: 2, perParcelFeeUgx: 15_000,
    });
  });

  it('paid with the order: the order charges the shipment', async () => {
    const result = await harness(shipment('checkout')).adapter.quote({ items: ITEMS });
    expect(result).toMatchObject({ feeUgx: 30_000, paidAtCollectionUgx: null, feeBeforeFreeDeliveryUgx: 30_000 });
  });
});

describe('a destination we cannot serve', () => {
  it('is an unconfirmed fee with the reason, never a zero that happens to be right', async () => {
    const outcome = { ...RIDER, mayFallBackToLegacy: true, quote: { kind: 'unavailable', mode: null, reason: 'CONFIG_INCOMPLETE', explanation: explanation(), missingConfigKeys: ['rider.ceiling'] } };
    const result = await harness(outcome).adapter.quote({ items: ITEMS });
    expect(result).toMatchObject({ feeUgx: null, confirmed: false, mayFallBackToLegacy: true, unavailableReason: 'CONFIG_INCOMPLETE', paidAtCollectionUgx: null });
    expect(result.capture).toMatchObject({ quotedFeeUgx: null, unavailableReason: 'CONFIG_INCOMPLETE', fulfilmentMode: null, expectedMinutes: null });
  });
});

describe('recording the capture', () => {
  it('upserts the capture against the order', async () => {
    const h = harness();
    await h.adapter.recordQuote('order-1', { areaSlug: 'ntinda', quotedFeeUgx: 8_000 });
    expect(h.ports.deliveryCaptureRepo.upsert).toHaveBeenCalledWith({ orderId: 'order-1', areaSlug: 'ntinda', quotedFeeUgx: 8_000 });
  });

  it('a failed capture is logged as an error, never swallowed', () => {
    const error = vi.fn();
    setAppLogger({ debug() {}, info() {}, warn() {}, error });
    const failure = new Error('connection reset');
    harness().adapter.onCaptureFailed('order-1', failure);
    expect(error).toHaveBeenCalledWith({ orderId: 'order-1', err: failure }, expect.stringContaining('capture write FAILED'));
  });

  it('reads each dependency when a quote is asked for, not when the adapter is built', async () => {
    const h = harness();
    const later = vi.fn(async () => RIDER);
    (h.ports as { deliveryQuotingUseCase: unknown }).deliveryQuotingUseCase = { execute: later };
    await h.adapter.quote({ items: ITEMS });
    expect(later).toHaveBeenCalledTimes(1);
  });
});

describe('the real Registry', () => {
  it('charges checkout and the delivery estimate through the same adapter', () => {
    const registry = Registry.getInstance();
    expect(Object.keys(registry.checkoutDeliveryQuoting).sort()).toEqual(['onCaptureFailed', 'quote', 'recordQuote']);
    const estimatePorts = (registry.getDeliveryEstimateUseCase as unknown as Record<string, unknown>);
    const held = Object.values(estimatePorts).find((v) => v && typeof v === 'object' && 'quoting' in (v as object)) as { quoting: unknown } | undefined;
    expect(held?.quoting).toBe(registry.checkoutDeliveryQuoting);
  });
});
