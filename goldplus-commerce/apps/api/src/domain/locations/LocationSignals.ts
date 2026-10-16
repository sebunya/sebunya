/**
 * Location signals (0193, 2026-10-16): what customers tell us about where they want delivery, used to price and
 * promise for their area everywhere, personalise what they see, learn where demand is and fix our area points.
 * Owner decision 2026-10-16: the experience comes first — signals link to the visitor's profile whatever their
 * consent state (recorded on each row for marketing uses), "Locate me" keeps the customer's own pin, and rows are
 * kept LOCATION_SIGNAL_RETENTION_DAYS. Never an IP, never anything from Google Places (contract, not preference:
 * Maps Platform Terms §3.2.3(c)).
 */
export const LOCATION_SIGNAL_KINDS = ['deliver_to_set', 'quote_shown', 'locate_offer_chosen', 'locate_offer_missed'] as const;
export type LocationSignalKind = (typeof LOCATION_SIGNAL_KINDS)[number];
export const LOCATION_SIGNAL_SURFACES = ['pdp', 'cart', 'checkout', 'account', 'home'] as const;
export type LocationSignalSurface = (typeof LOCATION_SIGNAL_SURFACES)[number];

/** Three years by default (several seasons to compare); LOCATION_SIGNAL_RETENTION_DAYS overrides. */
export const LOCATION_SIGNAL_RETENTION_DAYS = (() => {
  const n = Number(typeof process !== 'undefined' ? process.env.LOCATION_SIGNAL_RETENTION_DAYS : NaN);
  return Number.isInteger(n) && n >= 30 ? n : 1095;
})();

export interface LocationSignalInput {
  kind: LocationSignalKind;
  surface: LocationSignalSurface;
  areaSlug: string | null;
  district: string | null;
  label: string | null;
  feeUgx: number | null;
  quoteKind: string | null;
  offerRank: number | null;
  /** The customer's own pin ("Locate me": device GPS or a shared link). Stored to learn area points. */
  pin: { lat: number; lng: number; accuracyM: number | null } | null;
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
  const acc = Number((pinObj as { accuracyM?: unknown } | undefined)?.accuracyM);
  // A Google Places point is never a signal (Maps Platform Terms §3.2.3(c)): only the customer's own pin.
  const ownPin = (pinObj as { source?: unknown } | undefined)?.source !== 'map_place';
  const pin =
    ownPin && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -2.5 && lat <= 5.5 && lng >= 28 && lng <= 36.5
      ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, accuracyM: Number.isFinite(acc) && acc >= 0 && acc <= 100000 ? Math.round(acc) : null }
      : null;
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

export type AreaPointFlag = {
  areaSlug: string | null;
  label: string;
  reason: string;
  /** Where customers who chose this area actually were: the median of their accurate "Locate me" pins. */
  suggestedPoint?: { lat: number; lng: number; pins: number } | null;
};

/** Component-wise median of accurate pins (≤ 100 m) — a robust "where people really are" for an area. */
export function medianPoint(pins: Array<{ lat: number; lng: number; accuracyM: number | null }>, minPins = 3): { lat: number; lng: number; pins: number } | null {
  const good = pins.filter((p) => p.accuracyM === null || p.accuracyM <= 100);
  if (good.length < minPins) return null;
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  return { lat: Math.round(med(good.map((p) => p.lat)) * 1e6) / 1e6, lng: Math.round(med(good.map((p) => p.lng)) * 1e6) / 1e6, pins: good.length };
}

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
