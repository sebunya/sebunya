import { DISTANCE_BANDS, DistanceBand } from './DeliveryModel';

/**
 * How a destination is actually served (commercial constraint, 2026-08-06).
 *
 * This is a correction of a fact the model had wrong, not a refinement of it.
 * Outside Kampala and the Wakiso metro it is not physically possible to send a
 * rider — upcountry goes by bus, to a parcel office, where the customer
 * collects. Three of the eighteen real orders (Arua, Abim, Adjumani) cannot be
 * served by any path that assumes a boda.
 *
 * The mode is therefore a FIRST-CLASS property of a destination, and it decides
 * which pricing mechanism may even be consulted. It is not a flag that a
 * pricing function checks; it is the thing that selects the pricing function.
 */

export const FULFILMENT_MODES = ['own_rider', 'bus_parcel', 'pickup_only', 'unserviceable'] as const;
export type FulfilmentMode = (typeof FULFILMENT_MODES)[number];

export function isFulfilmentMode(value: string): value is FulfilmentMode {
  return (FULFILMENT_MODES as readonly string[]).includes(value);
}

/** Bands in distance order, so "at or below the ceiling" is a real comparison. */
export function bandRank(band: DistanceBand): number {
  return DISTANCE_BANDS.indexOf(band);
}

export function isWithinRiderRange(band: DistanceBand, maxBand: DistanceBand): boolean {
  return bandRank(band) <= bandRank(maxBand);
}

/**
 * What serves this destination.
 *
 * `ownRiderMaxBand` is required and ships unset. Unset means we do not know
 * where rider service ends, and the honest consequence is that NOTHING is
 * classified as own_rider — not that everything is. That is why this returns
 * null rather than a mode: a null propagates into CONFIG_INCOMPLETE naming the
 * key, which is the module's existing shape for "a human has not told us yet".
 *
 * The order of the checks is the same discipline as the refusal ordering: a
 * question is only asked once the one above it can be answered.
 */
export function resolveFulfilmentMode(
  area: {
    /** Null means the area is not in the 362-area metro corridor set at all. */
    corridor: string | null;
    band: DistanceBand | null;
    accessMode: 'road' | 'water' | null;
    serviceable: boolean;
    /** An explicit override set by ops beats any derivation. */
    declaredMode?: FulfilmentMode | null;
  },
  ownRiderMaxBand: DistanceBand | null,
): FulfilmentMode | null {
  // An operator's explicit decision is never second-guessed by a derivation.
  if (area.declaredMode) return area.declaredMode;

  // No corridor row means upcountry: outside the metro set entirely. This is
  // the line that used to produce AREA_NOT_METRO — accurate and useless. Those
  // customers are served, by bus, and saying so is the whole point.
  if (!area.corridor || !area.band) return 'bus_parcel';

  // Inside the metro set, the corridor row knows these two facts.
  if (!area.serviceable) return 'unserviceable';
  if (area.accessMode === 'water') return 'pickup_only';

  // Nobody has said where rider service ends, so nothing may claim to be
  // inside it. Unknown, not "everything".
  if (ownRiderMaxBand === null) return null;

  // Beyond the rider's range, a metro area is still served — by bus, like
  // anywhere else that far out. A 6.4 hour round trip is not a delivery.
  return isWithinRiderRange(area.band, ownRiderMaxBand) ? 'own_rider' : 'bus_parcel';
}

/**
 * The registry key naming the ceiling, so a refusal can point at what is
 * missing without the caller hardcoding the string.
 */
export const OWN_RIDER_MAX_BAND_KEY = 'own_rider_max_band';

/** What each mode means, in the operator's terms rather than the model's. */
export const FULFILMENT_MODE_LABELS: Record<FulfilmentMode, string> = {
  own_rider: 'Our own rider delivers to the door',
  bus_parcel: 'We put it on a bus; the customer collects from a parcel office',
  pickup_only: 'Collection only — we cannot reach it',
  unserviceable: 'We do not serve this area at all',
};
