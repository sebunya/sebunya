/**
 * Pins become area points (address system spec §5.6).
 *
 * For an area: handover pins from riders (accuracy ≤ 100 m) when there are at
 * least 3 and their p90 spread from the geometric median is ≤ 800 m, else
 * customer pins from orders found first time when there are at least 5 with
 * p90 ≤ 1,500 m. A wider spread is "probably two areas or an alias covering
 * several" and is listed for a person; the existing point is left alone. A
 * point set by hand is never overwritten.
 *
 * Pure geometry. The aggregate point keeps no per-customer data.
 */
import { haversineKm } from './DeliveryOrigin';

export interface LatLng {
  lat: number;
  lng: number;
}

export const AREA_POINT_RULES = {
  handover: { minPins: 3, maxP90M: 800, maxAccuracyM: 100 },
  delivered: { minPins: 5, maxP90M: 1500 },
} as const;

/** Weiszfeld's algorithm on a small equirectangular projection; exact enough at parish scale. */
export function geometricMedian(points: readonly LatLng[], iterations = 60): LatLng | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { ...points[0] };
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const cos = Math.cos((lat0 * Math.PI) / 180) || 1e-9;
  const xy = points.map((p) => ({ x: p.lng * cos, y: p.lat }));
  let cx = xy.reduce((s, p) => s + p.x, 0) / xy.length;
  let cy = xy.reduce((s, p) => s + p.y, 0) / xy.length;
  for (let k = 0; k < iterations; k++) {
    let wx = 0;
    let wy = 0;
    let w = 0;
    for (const p of xy) {
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < 1e-9) return { lat: p.y, lng: p.x / cos };
      const inv = 1 / d;
      wx += p.x * inv;
      wy += p.y * inv;
      w += inv;
    }
    const nx = wx / w;
    const ny = wy / w;
    const moved = Math.hypot(nx - cx, ny - cy);
    cx = nx;
    cy = ny;
    if (moved < 1e-9) break;
  }
  return { lat: cy, lng: cx / cos };
}

/** Nearest-rank p90 of the pins' distances (m) from the centre. */
export function p90SpreadMetres(points: readonly LatLng[], centre: LatLng): number {
  if (points.length === 0) return 0;
  const d = points.map((p) => haversineKm(centre, p) * 1000).sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(0.9 * d.length));
  return Math.round(d[rank - 1]);
}

export type AreaPointDecision =
  | { kind: 'write'; source: 'rider_handover' | 'delivered_pins'; point: LatLng; expectedErrorM: number; n: number }
  | { kind: 'wide_spread'; source: 'rider_handover' | 'delivered_pins'; p90M: number; n: number }
  | { kind: 'too_few'; handovers: number; customerPins: number }
  | { kind: 'manual_kept' };

export function decideAreaPoint(input: {
  currentSource: string | null;
  handoverPins: readonly (LatLng & { accuracyM: number | null })[];
  customerPins: readonly LatLng[];
}): AreaPointDecision {
  if (input.currentSource === 'manual') return { kind: 'manual_kept' };
  const good = input.handoverPins.filter((p) => p.accuracyM !== null && p.accuracyM <= AREA_POINT_RULES.handover.maxAccuracyM);
  if (good.length >= AREA_POINT_RULES.handover.minPins) {
    const centre = geometricMedian(good)!;
    const p90 = p90SpreadMetres(good, centre);
    if (p90 <= AREA_POINT_RULES.handover.maxP90M) return { kind: 'write', source: 'rider_handover', point: centre, expectedErrorM: p90, n: good.length };
    // Wide handovers are a stronger "two areas" signal than wide customer pins; say so and stop.
    return { kind: 'wide_spread', source: 'rider_handover', p90M: p90, n: good.length };
  }
  if (input.customerPins.length >= AREA_POINT_RULES.delivered.minPins) {
    const centre = geometricMedian(input.customerPins)!;
    const p90 = p90SpreadMetres(input.customerPins, centre);
    if (p90 <= AREA_POINT_RULES.delivered.maxP90M) return { kind: 'write', source: 'delivered_pins', point: centre, expectedErrorM: p90, n: input.customerPins.length };
    return { kind: 'wide_spread', source: 'delivered_pins', p90M: p90, n: input.customerPins.length };
  }
  return { kind: 'too_few', handovers: good.length, customerPins: input.customerPins.length };
}
