import { describe, it, expect } from 'vitest';
import {
  cutoffCountdown,
  freeDeliveryProgress,
  presentQuote,
  windowSentence,
} from '../../apps/api/src/domain/delivery/DeliveryPresentation';
import { FulfilmentQuote } from '../../apps/api/src/domain/delivery/DeliveryQuoteService';
import { DELIVERY_CONFIG_REGISTRY } from '../../apps/api/src/domain/delivery/DeliveryConfigRegistry';
import { UNAVAILABLE_REASONS, REASON_COPY_KEY } from '../../apps/api/src/domain/delivery/DeliveryModel';

const explanation = {
  originCode: 'HUB-CBD-WILSON',
  areaSlug: 'a',
  corridor: 'kira_rd',
  band: 'B2' as const,
  distanceSource: null,
  centroidSource: null,
  oneWayKm: null,
  roundTripKm: null,
  factors: {} as never,
  handlingMinutes: null,
  travelMinutes: null,
  lastMileMinutes: null,
  expectedMinutes: null,
  rawFeeUgx: null,
  roundingStepUgx: null,
  roundedFeeUgx: null,
  minimumFeeApplied: false,
  configVersionId: 'cfg-1',
  unavailableReason: null,
  missingConfigKeys: [],
};

const noProportionality = { findings: [], requiresAcknowledgement: false };

const unavailable = (reason: (typeof UNAVAILABLE_REASONS)[number]): FulfilmentQuote => ({
  kind: 'unavailable',
  mode: null,
  reason,
  explanation: { ...explanation, unavailableReason: reason },
  missingConfigKeys: [],
});

describe('tone — a customer who IS served never reads a refusal', () => {
  it('treats CARRIER_REQUIRED as served, not refused', () => {
    expect(presentQuote(unavailable('CARRIER_REQUIRED')).tone).toBe('served_differently');
  });

  it('treats NO_RATE_CARD as our gap, confirmed later — never a refusal to serve', () => {
    const p = presentQuote(unavailable('NO_RATE_CARD'));
    expect(p.tone).toBe('confirmed_later');
    expect(p.tone).not.toBe('not_served');
  });

  it('treats PARCEL_CLASS_UNKNOWN as our gap too', () => {
    expect(presentQuote(unavailable('PARCEL_CLASS_UNKNOWN')).tone).toBe('confirmed_later');
  });

  it('prompts narrowing on AREA_TOO_COARSE rather than apologising', () => {
    expect(presentQuote(unavailable('AREA_TOO_COARSE')).tone).toBe('needs_narrowing');
  });

  it('says not served only where we genuinely cannot serve', () => {
    expect(presentQuote(unavailable('AREA_UNSERVICEABLE')).tone).toBe('not_served');
    expect(presentQuote(unavailable('WATER_ACCESS')).tone).toBe('not_served');
  });

  it('treats our own configuration gap as confirmed later', () => {
    expect(presentQuote(unavailable('CONFIG_INCOMPLETE')).tone).toBe('confirmed_later');
    expect(presentQuote(unavailable('NO_ACTIVE_ORIGIN')).tone).toBe('confirmed_later');
  });

  it('offers pickup alongside EVERY outcome, including the refusals', () => {
    for (const reason of UNAVAILABLE_REASONS) {
      const p = presentQuote(unavailable(reason));
      expect(p.pickup.alwaysShown, reason).toBe(true);
      expect(p.pickup.copyKey).toBe('copy_pickup_offer');
    }
  });

  it('names a registry key for every reason, never a literal sentence', () => {
    const keys = new Set(DELIVERY_CONFIG_REGISTRY.map((e) => e.key));
    for (const reason of UNAVAILABLE_REASONS) {
      const p = presentQuote(unavailable(reason));
      expect(p.copyKey, reason).toBe(REASON_COPY_KEY[reason]);
      expect(keys.has(p.copyKey!), p.copyKey!).toBe(true);
    }
  });
});

describe('the proportionality interstitial', () => {
  const disproportionate: FulfilmentQuote = {
    kind: 'rider_delivery',
    mode: 'own_rider',
    feeUgx: 35_000,
    expectedMinutes: 60,
    window: { kind: 'day', note: 'no_on_time_target' },
    explanation,
    proportionality: {
      requiresAcknowledgement: true,
      findings: [
        {
          kind: 'fee_exceeds_value',
          feeUgx: 35_000,
          subtotalUgx: 20_000,
          ratio: 1.75,
          ceiling: 0.5,
          proportionateAtUgx: 70_000,
          addToReachProportionateUgx: 50_000,
          freeDeliveryAtUgx: 150_000,
          addToReachFreeUgx: 130_000,
        },
      ],
    },
  };

  it('is never the default option, and never hidden', () => {
    const p = presentQuote(disproportionate);
    expect(p.requiresAcknowledgement).toBe(true);
    expect(p.mayBeDefault).toBe(false);
    // Still quoted — the sale is never blocked.
    expect(p.feeUgx).toBe(35_000);
    expect(p.tone).toBe('quoted');
  });

  it('shows exactly what basket value makes it proportionate, and the free threshold', () => {
    const p = presentQuote(disproportionate);
    expect(p.proportionality).toMatchObject({
      proportionateAtUgx: 70_000,
      addToReachProportionateUgx: 50_000,
      freeDeliveryAtUgx: 150_000,
      addToReachFreeUgx: 130_000,
    });
  });

  it('a proportionate quote may be the default', () => {
    const fine: FulfilmentQuote = { ...disproportionate, proportionality: noProportionality };
    const p = presentQuote(fine);
    expect(p.mayBeDefault).toBe(true);
    expect(p.requiresAcknowledgement).toBe(false);
    expect(p.proportionality).toBeNull();
  });

  it('a basket below the minimum is informative, not a gate', () => {
    const low: FulfilmentQuote = {
      ...disproportionate,
      proportionality: {
        requiresAcknowledgement: false,
        findings: [{ kind: 'below_minimum_order', mode: 'bus_parcel', subtotalUgx: 15_000, minimumUgx: 50_000, shortfallUgx: 35_000 }],
      },
    };
    const p = presentQuote(low);
    expect(p.belowMinimum).toEqual({ minimumUgx: 50_000, shortfallUgx: 35_000 });
    // No tick box for having a small order.
    expect(p.requiresAcknowledgement).toBe(false);
    expect(p.mayBeDefault).toBe(true);
  });
});

describe('the parcel count is part of the promise, not a surprise', () => {
  const shipment: FulfilmentQuote = {
    kind: 'bus_shipment',
    mode: 'bus_parcel',
    feeUgx: 75_000,
    perParcelFeeUgx: 25_000,
    parcelCount: 3,
    parcelSentence: 'Your order is too big for one parcel, so it ships as 3 parcels at UGX 25,000 each.',
    shipment: {
      feeUgx: 25_000,
      carrier: 'Gaagaa',
      rateCardId: 'c1',
      rateCardVersion: 1,
      parcelClass: 'small',
      transitDaysMin: 1,
      transitDaysMax: 2,
      chargedAt: 'collection',
      insuranceUgx: null,
      office: null,
    },
    explanation,
    proportionality: noProportionality,
  };

  it('carries the count, the per-parcel fee and the total', () => {
    const p = presentQuote(shipment);
    expect(p.parcelCount).toBe(3);
    expect(p.perParcelFeeUgx).toBe(25_000);
    expect(p.feeUgx).toBe(75_000);
    expect(p.parcelSentence).toContain('3 parcels');
  });

  it('says shipment and collection, never delivery to the door', () => {
    const p = presentQuote(shipment);
    expect(p.shipmentSentence).toContain('collect');
    expect(p.shipmentSentence!.toLowerCase()).not.toContain('to your door');
    expect(p.copyKey).toBe('copy_carrier_required');
  });
});

describe('the cutoff countdown, in East Africa Time', () => {
  it('says nothing at all when no cutoff is configured', () => {
    // No cutoff means NO same-day promise, not a default time somebody guessed.
    expect(cutoffCountdown({ now: new Date('2026-08-06T09:00:00Z'), cutoffClock: null })).toBeNull();
  });

  it('counts down before the cutoff, in EAT not UTC', () => {
    // 09:00 UTC is 12:00 EAT, so a 15:30 EAT cutoff is 3h30 away.
    const c = cutoffCountdown({ now: new Date('2026-08-06T09:00:00Z'), cutoffClock: '15:30' });
    expect(c).toBeTruthy();
    expect(c!.beforeCutoff).toBe(true);
    expect(c!.minutesRemaining).toBe(210);
    expect(c!.sentence).toContain('3 hours 30 min');
    expect(c!.zoneLabel).toBe('EAT');
  });

  it('is correct across the UTC day boundary, where this breaks', () => {
    // 22:00 UTC on the 6th is 01:00 EAT on the 7th — already past a 15:30
    // cutoff for the 7th's morning, so it must NOT claim same-day dispatch.
    const c = cutoffCountdown({ now: new Date('2026-08-06T22:00:00Z'), cutoffClock: '15:30' });
    expect(c!.beforeCutoff).toBe(true);
    // 01:00 EAT to 15:30 EAT is 14h30.
    expect(c!.minutesRemaining).toBe(870);
  });

  it('reports the cutoff as passed after it', () => {
    // 14:00 UTC is 17:00 EAT, past a 15:30 cutoff.
    const c = cutoffCountdown({ now: new Date('2026-08-06T14:00:00Z'), cutoffClock: '15:30' });
    expect(c!.beforeCutoff).toBe(false);
    expect(c!.sentence).toContain('has passed');
  });

  it('refuses a cutoff that is not a real time of day', () => {
    expect(cutoffCountdown({ now: new Date(), cutoffClock: '25:99' })).toBeNull();
  });
});

describe('free-delivery progress is exact, never a rounded nudge', () => {
  it('is null when the mechanic is off', () => {
    expect(freeDeliveryProgress({ thresholdUgx: null, basisUgx: 50_000 })).toBeNull();
    expect(freeDeliveryProgress({ thresholdUgx: 0, basisUgx: 50_000 })).toBeNull();
  });

  it('reports the EXACT remaining amount', () => {
    const p = freeDeliveryProgress({ thresholdUgx: 150_000, basisUgx: 137_450 });
    expect(p).toMatchObject({ remainingUgx: 12_550, qualifies: false });
  });

  it('never reports a negative remainder or over 100 percent', () => {
    const p = freeDeliveryProgress({ thresholdUgx: 150_000, basisUgx: 400_000 });
    expect(p).toMatchObject({ remainingUgx: 0, qualifies: true, pct: 100 });
  });
});

describe('the window promise stays at day level until an hour window is earned', () => {
  it('promises a day, never a point in time', () => {
    const s = windowSentence({ kind: 'day', note: 'insufficient_sample' });
    expect(s).toContain('day');
    expect(s).not.toMatch(/\d+:\d+/);
  });

  it('quotes hours only with a sample, and says how big it was', () => {
    const s = windowSentence({ kind: 'hours', lowMinutes: 120, highMinutes: 300, sampleSize: 44 });
    expect(s).toContain('2 to 5 hours');
    expect(s).toContain('44 deliveries');
  });

  it('says nothing when there is no window at all', () => {
    expect(windowSentence(null)).toBeNull();
  });
});
