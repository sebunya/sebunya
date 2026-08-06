import { SHIPPING_CLASSES, ShippingClass } from './DeliveryParcelClass';

/**
 * Bus parcel pricing (commercial constraint, 2026-08-06).
 *
 * Upcountry is a SHIPMENT TO A PARCEL OFFICE, not a delivery. We put the parcel
 * on a bus, it reaches a named office in the customer's town, and the customer
 * collects it there. The language says shipment and collection, never "delivery
 * to your door", because that is not what happens and promising it creates the
 * dispute.
 *
 * The price is a NEGOTIATED RATE CARD and never a model. Nothing here fits,
 * shrinks, interpolates or extrapolates. Two prohibitions carry the weight:
 *
 *   * a destination with no current card returns NO_RATE_CARD. It never
 *     borrows a fee from the next town along the road;
 *   * a parcel class with no fee is not derived from the class above or below.
 *
 * Both would produce a number nobody negotiated, which the customer would be
 * charged and the carrier would not honour.
 */

/**
 * RETIRED 2026-08-06 (pre-decided): the weight-band system is gone.
 *
 * A shipping class is now a property of the goods, resolved from a product
 * override then a category default then not at all — see
 * `DeliveryParcelClass.ts`. Weights were never in the catalogue, so classifying
 * by them meant every basket resolved to WEIGHT_UNKNOWN: a data system nobody
 * was going to populate.
 *
 * The rate card still prices per class and per PARCEL, because bus parcel
 * offices count parcels.
 */
export type ParcelClass = ShippingClass;
export const PARCEL_CLASSES = SHIPPING_CLASSES;

/** Who pays the carrier, and when. Both are real arrangements in this market. */
export type ChargedAt = 'sending' | 'collection';

export interface BusRateCard {
  id: string;
  carrier: string;
  destinationTown: string;
  destinationDistrict: string;
  parcelClass: ParcelClass;
  feeUgx: number;
  /** Null means the carrier offers no cover, which is not the same as zero. */
  insurancePctOfDeclaredValue: number | null;
  transitDaysMin: number;
  transitDaysMax: number;
  chargedAt: ChargedAt;
  effectiveFrom: Date;
  /** Null means open-ended. A past date means expired. */
  effectiveTo: Date | null;
  version: number;
}

export interface ParcelOffice {
  id: string;
  carrier: string;
  officeName: string;
  town: string;
  district: string;
  areaSlug: string | null;
  physicalAddress: string | null;
  landmark: string | null;
  phone: string | null;
  openingHours: string | null;
  departureTimes: string | null;
  collectionWindow: string | null;
}

export function isCardCurrent(card: BusRateCard, at: Date): boolean {
  if (card.effectiveFrom.getTime() > at.getTime()) return false;
  if (card.effectiveTo !== null && card.effectiveTo.getTime() <= at.getTime()) return false;
  return true;
}

export type RateCardSelection =
  | { ok: true; card: BusRateCard }
  | {
      ok: false;
      reason:
        | 'NO_CARD_FOR_DESTINATION'
        | 'ALL_CARDS_EXPIRED'
        | 'NO_CARD_FOR_PARCEL_CLASS';
      /** What a human needs to go and negotiate. */
      detail: string;
    };

/**
 * Pick the card that prices this shipment.
 *
 * Given several current cards for one destination and class — more than one
 * carrier serves most trunk routes — the cheapest wins, and ties break on the
 * later version so a renegotiation supersedes its predecessor.
 *
 * An expired card is never used as a fallback. "When a card expires with no
 * successor, the destination returns fee_unavailable and the manual path
 * handles it": charging last season's rate is a promise the carrier has already
 * withdrawn.
 */
export function selectRateCard(
  cards: readonly BusRateCard[],
  request: { destinationTown: string; destinationDistrict: string; parcelClass: ParcelClass; at: Date },
): RateCardSelection {
  const town = request.destinationTown.trim().toLowerCase();
  const district = request.destinationDistrict.trim().toLowerCase();

  // Exact destination only. Never the next town along the road.
  const forDestination = cards.filter(
    (c) =>
      c.destinationTown.trim().toLowerCase() === town &&
      c.destinationDistrict.trim().toLowerCase() === district,
  );
  if (forDestination.length === 0) {
    return {
      ok: false,
      reason: 'NO_CARD_FOR_DESTINATION',
      detail: `No carrier rate card exists for ${request.destinationTown}, ${request.destinationDistrict}.`,
    };
  }

  const current = forDestination.filter((c) => isCardCurrent(c, request.at));
  if (current.length === 0) {
    return {
      ok: false,
      reason: 'ALL_CARDS_EXPIRED',
      detail: `Every rate card for ${request.destinationTown} has expired with no successor. A renegotiation is overdue.`,
    };
  }

  // Exact class only. A medium parcel is never priced off the small card.
  const forClass = current.filter((c) => c.parcelClass === request.parcelClass);
  if (forClass.length === 0) {
    return {
      ok: false,
      reason: 'NO_CARD_FOR_PARCEL_CLASS',
      detail: `No carrier prices a ${request.parcelClass} parcel to ${request.destinationTown}.`,
    };
  }

  const sorted = [...forClass].sort((a, b) => a.feeUgx - b.feeUgx || b.version - a.version);
  return { ok: true, card: sorted[0] };
}

export interface ShipmentQuote {
  feeUgx: number;
  carrier: string;
  /** Recorded on the quote so it can be reproduced and disputed. */
  rateCardId: string;
  rateCardVersion: number;
  parcelClass: ParcelClass;
  transitDaysMin: number;
  transitDaysMax: number;
  chargedAt: ChargedAt;
  insuranceUgx: number | null;
  office: ParcelOffice | null;
}

/**
 * Build the shipment quote from a selected card.
 *
 * Insurance is a percentage OF THE DECLARED VALUE, so with no declared value
 * there is no insurance figure — null, not zero. Zero would read as "insured
 * for nothing at no cost", which is a different and false statement.
 */
export function buildShipmentQuote(input: {
  card: BusRateCard;
  office: ParcelOffice | null;
  declaredValueUgx: number | null;
}): ShipmentQuote {
  const pct = input.card.insurancePctOfDeclaredValue;
  const insuranceUgx =
    pct === null || input.declaredValueUgx === null || !Number.isFinite(input.declaredValueUgx)
      ? null
      : Math.round((input.declaredValueUgx * pct) / 100);

  return {
    feeUgx: input.card.feeUgx,
    carrier: input.card.carrier,
    rateCardId: input.card.id,
    rateCardVersion: input.card.version,
    parcelClass: input.card.parcelClass,
    transitDaysMin: input.card.transitDaysMin,
    transitDaysMax: input.card.transitDaysMax,
    chargedAt: input.card.chargedAt,
    insuranceUgx,
    office: input.office,
  };
}

/**
 * What the customer is told, in shipment language.
 *
 * Kept here rather than in a page so every surface says the same thing, and
 * built from facts rather than adjectives: a named office, a named town, a
 * transit range and who pays when.
 */
export function shipmentSummary(quote: ShipmentQuote): string {
  const days =
    quote.transitDaysMin === quote.transitDaysMax
      ? `${quote.transitDaysMin} day${quote.transitDaysMin === 1 ? '' : 's'}`
      : `${quote.transitDaysMin} to ${quote.transitDaysMax} days`;
  const where = quote.office ? `${quote.office.officeName} in ${quote.office.town}` : 'the carrier’s parcel office in your town';
  const pay = quote.chargedAt === 'collection' ? 'You pay the carrier when you collect it.' : 'The shipping fee is paid with your order.';
  return `We send your parcel by ${quote.carrier} to ${where}, and you collect it there. It usually takes ${days}. ${pay}`;
}
