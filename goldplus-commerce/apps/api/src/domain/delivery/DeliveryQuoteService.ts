import {
  AreaInput,
  QuoteExplanation,
  QuoteInputs,
  UnavailableReason,
  narrowToOwnRider,
  quoteDelivery,
  DeliveryWindow,
} from './DeliveryModel';
import { FulfilmentMode, OWN_RIDER_MAX_BAND_KEY } from './DeliveryFulfilmentMode';
import {
  BusRateCard,
  ParcelClass,
  ParcelOffice,
  ShipmentQuote,
  buildShipmentQuote,
  selectRateCard,
} from './DeliveryBusRateCard';
import { ProportionalityConfig, ProportionalityResult, assessProportionality } from './DeliveryProportionality';
import { ParcelPlan, parcelCountSentence } from './DeliveryParcelClass';

/**
 * THE quoting service (contract #1: exactly one thing answers "what does
 * delivery cost").
 *
 * Everything else is its internals. The computed minutes model prices own-rider
 * destinations; a negotiated rate card prices bus shipments; and this decides
 * which of those is even consulted, based on the destination's fulfilment mode.
 *
 * The order of decisions is the module's standing discipline — never answer a
 * question the one above it has not earned:
 *
 *   1. did the address resolve at all
 *   2. is it precise enough to price
 *   3. HOW is this destination served      <- the 2026-08-06 constraint
 *   4. can that mechanism produce a number
 *   5. is the number proportionate to the basket
 *
 * Step 3 is new and it moved above everything about fees, which is why the
 * shape of the result changed rather than gaining a field.
 */

export interface FulfilmentQuoteInputs {
  area: AreaInput | null;
  /** Resolved once, above; null means the rider ceiling is unset. */
  mode: FulfilmentMode | null;
  /** For the computed path. Ignored entirely on the bus path. */
  rider: Omit<QuoteInputs, 'area'>;
  /** For the bus path. Ignored entirely on the rider path. */
  bus: {
    cards: readonly BusRateCard[];
    office: ParcelOffice | null;
    /**
     * How the basket splits into parcels. Bus parcel offices count PARCELS, so
     * the fee is per parcel and the count is part of the quote rather than a
     * detail discovered later.
     */
    parcels: ParcelPlan;
    destinationTown: string | null;
    destinationDistrict: string | null;
    at: Date;
    declaredValueUgx: number | null;
  };
  /** Merchandise subtotal, for the proportionality rules. */
  subtotalUgx: number;
  proportionality: ProportionalityConfig;
}

export type FulfilmentQuote =
  | {
      kind: 'rider_delivery';
      mode: 'own_rider';
      feeUgx: number;
      expectedMinutes: number;
      window: DeliveryWindow;
      explanation: QuoteExplanation;
      proportionality: ProportionalityResult;
    }
  | {
      kind: 'bus_shipment';
      mode: 'bus_parcel';
      /** TOTAL across every parcel — what the customer actually pays. */
      feeUgx: number;
      /** Per parcel, so the arithmetic is visible rather than implied. */
      perParcelFeeUgx: number;
      parcelCount: number;
      /** Shown BEFORE they commit. Two parcels is two fees. */
      parcelSentence: string;
      shipment: ShipmentQuote;
      explanation: QuoteExplanation;
      proportionality: ProportionalityResult;
    }
  | {
      kind: 'unavailable';
      mode: FulfilmentMode | null;
      reason: UnavailableReason;
      explanation: QuoteExplanation;
      /** Named so a missing decision is visible rather than mysterious. */
      missingConfigKeys: string[];
    };

function unavailable(
  reason: UnavailableReason,
  mode: FulfilmentMode | null,
  explanation: QuoteExplanation,
  missingConfigKeys: string[] = [],
): FulfilmentQuote {
  return {
    kind: 'unavailable',
    mode,
    reason,
    explanation: { ...explanation, unavailableReason: reason, missingConfigKeys },
    missingConfigKeys,
  };
}

function baseExplanation(inputs: FulfilmentQuoteInputs): QuoteExplanation {
  return {
    originCode: inputs.rider.originCode,
    areaSlug: inputs.area?.areaSlug ?? null,
    corridor: inputs.area?.corridor ?? null,
    band: inputs.area?.band ?? null,
    distanceSource: null,
    centroidSource: inputs.area?.centroidSource ?? null,
    oneWayKm: null,
    roundTripKm: null,
    factors: {
      corridor: inputs.rider.corridorFactor,
      hour: inputs.rider.hourFactor,
      detour: inputs.rider.detourFactor,
      lastMile: inputs.rider.lastMileMinutes,
    },
    handlingMinutes: null,
    travelMinutes: null,
    lastMileMinutes: null,
    expectedMinutes: null,
    rawFeeUgx: null,
    roundingStepUgx: null,
    roundedFeeUgx: null,
    minimumFeeApplied: false,
    configVersionId: inputs.rider.configVersionId,
    unavailableReason: null,
    missingConfigKeys: [],
  };
}

export function quoteFulfilment(inputs: FulfilmentQuoteInputs): FulfilmentQuote {
  const explanation = baseExplanation(inputs);

  // 1. Did the address resolve to anything at all?
  if (!inputs.area) return unavailable('AREA_UNRESOLVED', null, explanation);

  // 2. A district is a correct resolution that is not precise enough to price.
  //    Not a refusal: the customer narrows to an area and gets a number.
  if (inputs.area.districtOnly) return unavailable('AREA_TOO_COARSE', null, explanation);

  // 3. HOW is this destination served? Nobody has said where rider service ends,
  //    so nothing may claim to be inside it — including, deliberately, the metro
  //    areas that used to quote. An unset ceiling is a missing decision, and the
  //    module's shape for that is to name the key rather than assume a value.
  if (inputs.mode === null) {
    return unavailable('CONFIG_INCOMPLETE', null, explanation, [OWN_RIDER_MAX_BAND_KEY]);
  }
  if (inputs.mode === 'unserviceable') return unavailable('AREA_UNSERVICEABLE', inputs.mode, explanation);
  if (inputs.mode === 'pickup_only') return unavailable('WATER_ACCESS', inputs.mode, explanation);

  // 4a. Bus. A negotiated card or nothing — never a model, never a neighbour's
  //     fee, never a class interpolated from the one above it.
  if (inputs.mode === 'bus_parcel') {
    if (!inputs.bus.destinationTown || !inputs.bus.destinationDistrict) {
      return unavailable('NO_RATE_CARD', inputs.mode, explanation);
    }
    // No shipping class, or no known capacity to split by. Both are facts about
    // OUR data rather than about the destination, and both go to the manual
    // queue. Never guessed: small is the cheapest class, so a guess would
    // systematically under-charge and only surface at the carrier's counter.
    if (!inputs.bus.parcels.ok) {
      return unavailable(
        inputs.bus.parcels.reason === 'PARCEL_CLASS_UNKNOWN' ? 'PARCEL_CLASS_UNKNOWN' : 'NO_RATE_CARD',
        inputs.mode,
        explanation,
      );
    }
    const plan = inputs.bus.parcels;
    const selection = selectRateCard(inputs.bus.cards, {
      destinationTown: inputs.bus.destinationTown,
      destinationDistrict: inputs.bus.destinationDistrict,
      parcelClass: plan.shippingClass,
      at: inputs.bus.at,
    });
    if (!selection.ok) {
      // The destination IS served — we simply have not closed a negotiation for
      // it. CARRIER_REQUIRED would overstate what we can do today.
      return unavailable('NO_RATE_CARD', inputs.mode, explanation);
    }
    const shipment = buildShipmentQuote({
      card: selection.card,
      office: inputs.bus.office,
      declaredValueUgx: inputs.bus.declaredValueUgx,
    });
    // Per parcel, because that is how a parcel office charges.
    const totalFee = shipment.feeUgx * plan.parcelCount;
    return {
      kind: 'bus_shipment',
      mode: 'bus_parcel',
      feeUgx: totalFee,
      perParcelFeeUgx: shipment.feeUgx,
      parcelCount: plan.parcelCount,
      parcelSentence: parcelCountSentence(plan, shipment.feeUgx),
      shipment,
      explanation: { ...explanation, rawFeeUgx: totalFee, roundedFeeUgx: totalFee },
      proportionality: assessProportionality({
        feeUgx: totalFee,
        subtotalUgx: inputs.subtotalUgx,
        mode: 'bus_parcel',
        config: inputs.proportionality,
      }),
    };
  }

  // 4b. Own rider. The computed model, which structurally cannot be reached
  //     with anything but an own-rider destination.
  const ownRider = narrowToOwnRider({ ...inputs.area, fulfilmentMode: inputs.mode });
  if (!ownRider) {
    // Mode says own_rider but corridor or band is missing. That combination
    // should be unreachable; if it happens the data is wrong, and inventing a
    // band would hide it.
    return unavailable('AREA_UNRESOLVED', inputs.mode, explanation);
  }
  const result = quoteDelivery({ ...inputs.rider, area: ownRider });
  if (!result.available) {
    return unavailable(result.reason, 'own_rider', result.explanation, result.explanation.missingConfigKeys);
  }
  return {
    kind: 'rider_delivery',
    mode: 'own_rider',
    feeUgx: result.feeUgx,
    expectedMinutes: result.expectedMinutes,
    window: result.window,
    explanation: result.explanation,
    proportionality: assessProportionality({
      feeUgx: result.feeUgx,
      subtotalUgx: inputs.subtotalUgx,
      mode: 'own_rider',
      config: inputs.proportionality,
    }),
  };
}

/**
 * Whether a quote may be presented as the default option.
 *
 * A disproportionate fee is still available — the sale is never blocked — but
 * it must not be pre-selected. Surfaces ask this rather than re-deriving it, so
 * one rule governs the product page, the cart and checkout alike.
 */
export function mayBeDefaultOption(quote: FulfilmentQuote): boolean {
  if (quote.kind === 'unavailable') return false;
  return !quote.proportionality.requiresAcknowledgement;
}
