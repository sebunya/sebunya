import { REASON_COPY_KEY, SERVED_BY_ANOTHER_MODE, ACTIONABLE_BY_CUSTOMER, DeliveryWindow } from './DeliveryModel';
import { FulfilmentQuote } from './DeliveryQuoteService';
import { shipmentSummary } from './DeliveryBusRateCard';
import { EAT_LABEL, sameDayCutoff, toEatParts } from '@goldplus/shared';

/**
 * What a customer is SHOWN, derived once so the product page, the cart and
 * checkout cannot disagree.
 *
 * Every string comes from the registry — nothing here hardcodes copy. What this
 * owns is the DECISION about which string, which tone, and what may be the
 * default option; the words themselves are Tier 1 and editable with a preview.
 *
 * The tone rule matters as much as the words:
 *   * CARRIER_REQUIRED and NO_RATE_CARD are NOT refusals. The customer IS
 *     served. Rendering them in the refusal style is a bug;
 *   * AREA_TOO_COARSE is one step from a price, so it prompts rather than
 *     apologises;
 *   * a disproportionate fee is never the pre-selected option, and never
 *     hidden either.
 */

export type PresentationTone =
  /** A price. Nothing to explain. */
  | 'quoted'
  /** Served, by another mode. Never reads as a refusal. */
  | 'served_differently'
  /** One customer action away from a price. */
  | 'needs_narrowing'
  /** We cannot serve this, at any price. Offer pickup. */
  | 'not_served'
  /** Our own gap. The order still completes through the manual path. */
  | 'confirmed_later';

export interface PickupOffer {
  /** Registry copy, so the landmarks are editable and never hardcoded. */
  copyKey: 'copy_pickup_offer';
  /** Shown alongside EVERY quote, per PART 9 #23. */
  alwaysShown: true;
}

export interface PresentedQuote {
  tone: PresentationTone;
  /** The registry key holding the sentence. Never the sentence itself. */
  copyKey: string | null;
  feeUgx: number | null;
  /** Bus only: the fee is per parcel and the count is part of the promise. */
  perParcelFeeUgx: number | null;
  parcelCount: number | null;
  parcelSentence: string | null;
  /** Rider only. */
  window: DeliveryWindow | null;
  expectedMinutes: number | null;
  /** Bus only, built from facts rather than adjectives. */
  shipmentSentence: string | null;
  /** Always offered, whatever the outcome. */
  pickup: PickupOffer;
  /** True when the customer must actively acknowledge before choosing this. */
  requiresAcknowledgement: boolean;
  mayBeDefault: boolean;
  /** Set when the fee is out of proportion to the basket. */
  proportionality: {
    feeUgx: number;
    subtotalUgx: number;
    proportionateAtUgx: number;
    addToReachProportionateUgx: number;
    freeDeliveryAtUgx: number | null;
    addToReachFreeUgx: number | null;
  } | null;
  /** Set when the basket is under the destination's minimum. */
  belowMinimum: { minimumUgx: number; shortfallUgx: number } | null;
}

const PICKUP: PickupOffer = { copyKey: 'copy_pickup_offer', alwaysShown: true };

export function presentQuote(quote: FulfilmentQuote): PresentedQuote {
  const proportional = quote.kind === 'unavailable' ? null : quote.proportionality;
  const ratio = proportional?.findings.find((f) => f.kind === 'fee_exceeds_value');
  const minimum = proportional?.findings.find((f) => f.kind === 'below_minimum_order');

  const shared = {
    pickup: PICKUP,
    requiresAcknowledgement: proportional?.requiresAcknowledgement ?? false,
    mayBeDefault: quote.kind !== 'unavailable' && !(proportional?.requiresAcknowledgement ?? false),
    proportionality:
      ratio && ratio.kind === 'fee_exceeds_value'
        ? {
            feeUgx: ratio.feeUgx,
            subtotalUgx: ratio.subtotalUgx,
            proportionateAtUgx: ratio.proportionateAtUgx,
            addToReachProportionateUgx: ratio.addToReachProportionateUgx,
            freeDeliveryAtUgx: ratio.freeDeliveryAtUgx,
            addToReachFreeUgx: ratio.addToReachFreeUgx,
          }
        : null,
    belowMinimum:
      minimum && minimum.kind === 'below_minimum_order'
        ? { minimumUgx: minimum.minimumUgx, shortfallUgx: minimum.shortfallUgx }
        : null,
  };

  if (quote.kind === 'rider_delivery') {
    return {
      ...shared,
      tone: 'quoted',
      copyKey: null,
      feeUgx: quote.feeUgx,
      perParcelFeeUgx: null,
      parcelCount: null,
      parcelSentence: null,
      window: quote.window,
      expectedMinutes: quote.expectedMinutes,
      shipmentSentence: null,
    };
  }
  if (quote.kind === 'bus_shipment') {
    return {
      ...shared,
      tone: 'quoted',
      copyKey: 'copy_carrier_required',
      feeUgx: quote.feeUgx,
      perParcelFeeUgx: quote.perParcelFeeUgx,
      parcelCount: quote.parcelCount,
      parcelSentence: quote.parcelSentence,
      window: null,
      expectedMinutes: null,
      shipmentSentence: shipmentSummary(quote.shipment),
    };
  }

  const tone: PresentationTone = SERVED_BY_ANOTHER_MODE.includes(quote.reason)
    ? 'served_differently'
    : ACTIONABLE_BY_CUSTOMER.includes(quote.reason)
      ? 'needs_narrowing'
      : quote.reason === 'AREA_UNSERVICEABLE' || quote.reason === 'WATER_ACCESS'
        ? 'not_served'
        : // NO_RATE_CARD, PARCEL_CLASS_UNKNOWN, CONFIG_INCOMPLETE, NO_ACTIVE_ORIGIN
          // and AREA_UNRESOLVED are all OUR gaps. The order completes and the
          // team confirms — the customer has done nothing wrong.
          'confirmed_later';

  return {
    ...shared,
    tone,
    copyKey: REASON_COPY_KEY[quote.reason],
    feeUgx: null,
    perParcelFeeUgx: null,
    parcelCount: null,
    parcelSentence: null,
    window: null,
    expectedMinutes: null,
    shipmentSentence: null,
  };
}

/**
 * The same-day cutoff countdown, in East Africa Time.
 *
 * Returns null when no cutoff is configured — no cutoff means NO SAME-DAY
 * PROMISE IS MADE AT ALL, which is a weaker and honest position rather than a
 * default time somebody guessed.
 */
export interface CutoffCountdown {
  cutoffClock: string;
  zoneLabel: string;
  beforeCutoff: boolean;
  minutesRemaining: number;
  /** Rendered by the surface; kept here so every surface agrees. */
  sentence: string;
}

export function cutoffCountdown(input: { now: Date; cutoffClock: string | null }): CutoffCountdown | null {
  if (!input.cutoffClock) return null;
  const result = sameDayCutoff(input.now, input.cutoffClock);
  if (!result) return null;
  const minutesRemaining = Math.max(0, Math.floor(result.msRemaining / 60_000));
  const hours = Math.floor(minutesRemaining / 60);
  const mins = minutesRemaining % 60;
  const remaining = hours > 0 ? `${hours} hour${hours === 1 ? '' : 's'} ${mins} min` : `${mins} min`;
  return {
    cutoffClock: input.cutoffClock,
    zoneLabel: EAT_LABEL,
    beforeCutoff: result.beforeCutoff,
    minutesRemaining,
    sentence: result.beforeCutoff
      ? `Order within ${remaining} for dispatch today (before ${input.cutoffClock} ${EAT_LABEL}).`
      // Two sentences, not a dash: the owner's rule is that no customer-facing
      // sentence carries an em or en dash.
      : `Today's ${input.cutoffClock} ${EAT_LABEL} cut-off has passed. This goes out on the next dispatch day.`,
  };
}

/**
 * Free-delivery progress: the EXACT remaining amount, never a rounded nudge.
 *
 * Null when no threshold is configured, because the mechanic is off rather than
 * unreachable.
 */
export function freeDeliveryProgress(input: {
  thresholdUgx: number | null;
  basisUgx: number;
}): { thresholdUgx: number; basisUgx: number; remainingUgx: number; qualifies: boolean; pct: number } | null {
  if (input.thresholdUgx === null || !Number.isFinite(input.thresholdUgx) || input.thresholdUgx <= 0) return null;
  const remaining = Math.max(0, input.thresholdUgx - input.basisUgx);
  return {
    thresholdUgx: input.thresholdUgx,
    basisUgx: input.basisUgx,
    remainingUgx: remaining,
    qualifies: remaining === 0,
    // Guarded above: threshold > 0.
    pct: Math.min(100, (input.basisUgx / input.thresholdUgx) * 100),
  };
}

/**
 * The window sentence. DAY LEVEL until an hour window is earned.
 *
 * Never a point in time, and never widened to look cautious — when there is no
 * sample and no target we say less rather than inventing a range.
 */
export function windowSentence(window: DeliveryWindow | null): string | null {
  if (!window) return null;
  if (window.kind === 'day') return 'We will confirm your delivery day when your order is dispatched.';
  const low = Math.round(window.lowMinutes / 60);
  const high = Math.round(window.highMinutes / 60);
  return `Most deliveries to your area arrive within ${low} to ${high} hours of dispatch, measured over ${window.sampleSize} deliveries.`;
}
