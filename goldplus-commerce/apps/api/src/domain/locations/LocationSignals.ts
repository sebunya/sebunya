/**
 * Location signals (0193, 2026-10-16): what customers tell us about where they want delivery, kept for a stated
 * purpose — price and promise for their area everywhere, learn where demand is, check our area points — and deleted
 * after LOCATION_SIGNAL_RETENTION_DAYS. Never coordinates, never an IP, never anything from Google Places.
 */
export const LOCATION_SIGNAL_KINDS = ['deliver_to_set', 'quote_shown', 'locate_offer_chosen', 'locate_offer_missed'] as const;
export type LocationSignalKind = (typeof LOCATION_SIGNAL_KINDS)[number];
export const LOCATION_SIGNAL_SURFACES = ['pdp', 'cart', 'checkout', 'account', 'home'] as const;
export type LocationSignalSurface = (typeof LOCATION_SIGNAL_SURFACES)[number];

/** Thirteen months: a full year of seasons to compare, then gone. */
export const LOCATION_SIGNAL_RETENTION_DAYS = 395;

export interface LocationSignalInput {
  kind: LocationSignalKind;
  surface: LocationSignalSurface;
  areaSlug: string | null;
  district: string | null;
  label: string | null;
  feeUgx: number | null;
  quoteKind: string | null;
  offerRank: number | null;
  /** The customer's own pin, used ONLY to measure how far it is from the chosen area's point; never stored. */
  pin: { lat: number; lng: number } | null;
}

const SLUG = /^[a-z0-9-]{3,160}$/;
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = Array.from(v).filter((c) => c.charCodeAt(0) >= 32 && c !== '<' && c !== '>').join('').trim();
  return t ? t.slice(0, max) : null;
};

export function parseLocationSignal(raw: unknown): LocationSignalInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = LOCATION_SIGNAL_KINDS.find((k) => k === o.kind);
  const surface = LOCATION_SIGNAL_SURFACES.find((s) => s === o.surface);
  if (!kind || !surface) return null;
  const areaSlug = typeof o.areaSlug === 'string' && SLUG.test(o.areaSlug) ? o.areaSlug : null;
  const district = text(o.district, 60);
  if (!areaSlug && !district) return null;
  const fee = Number(o.feeUgx);
  const rank = Number(o.offerRank);
  const pinObj = o.pin as { lat?: unknown; lng?: unknown } | undefined;
  const lat = Number(pinObj?.lat);
  const lng = Number(pinObj?.lng);
  const pin = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -2.5 && lat <= 5.5 && lng >= 28 && lng <= 36.5 ? { lat, lng } : null;
  return {
    kind,
    surface,
    areaSlug,
    district,
    label: text(o.label, 120),
    feeUgx: Number.isInteger(fee) && fee >= 0 && fee <= 5_000_000 ? fee : null,
    quoteKind: text(o.quoteKind, 40),
    offerRank: kind === 'locate_offer_chosen' && Number.isInteger(rank) && rank >= 1 && rank <= 10 ? rank : null,
    // A pin only matters to the two "Locate me" kinds, and only to measure a distance.
    pin: kind === 'locate_offer_chosen' || kind === 'locate_offer_missed' ? pin : null,
  };
}

export interface AreaDemandRow {
  areaSlug: string | null;
  label: string;
  district: string | null;
  deliverToSets: number;
  feeViews: number;
  orders: number;
  medianFeeShownUgx: number | null;
  locateChosen: number;
  locateMissed: number;
  medianOfferKm: number | null;
}

export type AreaPointFlag = { areaSlug: string | null; label: string; reason: string };

/**
 * Areas whose point may be in the wrong place: customers who used "Locate me" and then had to TYPE this area
 * (it was not among the nearest three offered), or who chose it from far away. Never acted on automatically:
 * a person checks the point (manual points, nightly area points).
 */
export function areaPointFlags(rows: AreaDemandRow[], minEvents = 3): AreaPointFlag[] {
  const out: AreaPointFlag[] = [];
  for (const r of rows) {
    const total = r.locateChosen + r.locateMissed;
    if (total < minEvents) continue;
    if (r.locateMissed * 2 >= total) out.push({ areaSlug: r.areaSlug, label: r.label, reason: `${r.locateMissed} of ${total} customers who used Locate me had to type it: its point may be off.` });
    else if (r.medianOfferKm !== null && r.medianOfferKm > 3) out.push({ areaSlug: r.areaSlug, label: r.label, reason: `Customers choosing it were a median ${r.medianOfferKm} km from its point.` });
  }
  return out;
}

/** Areas where people look at the fee and do not buy, worst first (needs at least `minViews` fee views). */
export function feeShockAreas(rows: AreaDemandRow[], minViews = 10): Array<AreaDemandRow & { conversion: number }> {
  return rows
    .filter((r) => r.feeViews >= minViews)
    .map((r) => ({ ...r, conversion: r.orders / r.feeViews }))
    .sort((a, b) => a.conversion - b.conversion);
}
