import type { DistanceBand } from './DeliveryModel';

/**
 * Per-road rider limits (owner, 2026-10-16): "the furthest rider area should be
 * against every major road". `own_rider_max_band_by_corridor` is a string like
 * `jinja_rd=B5, entebbe_rd=B4`; a corridor named here uses its own ceiling,
 * every other corridor keeps `own_rider_max_band`. The literal `none` (or an
 * empty value) means no per-road limits.
 */
export type CorridorCeilings = Readonly<Record<string, DistanceBand>>;

export function parseCorridorCeilings(raw: string | null | undefined): { ok: true; ceilings: CorridorCeilings } | { ok: false; message: string } {
  const text = (raw ?? '').trim();
  if (!text || text.toLowerCase() === 'none') return { ok: true, ceilings: {} };
  const out: Record<string, DistanceBand> = {};
  for (const part of text.split(/[,;\n]+/)) {
    const item = part.trim();
    if (!item) continue;
    const m = /^([a-z][a-z0-9_]{1,39})\s*[=:]\s*(B[0-6])$/i.exec(item);
    if (!m) return { ok: false, message: `"${item}" is not corridor=band (for example jinja_rd=B5).` };
    const corridor = m[1].toLowerCase();
    if (corridor in out) return { ok: false, message: `${corridor} is listed twice.` };
    out[corridor] = m[2].toUpperCase() as DistanceBand;
  }
  return { ok: true, ceilings: out };
}

/** The ceiling that applies to one corridor: its own when set, else the shop-wide one. */
export function ceilingForCorridor(corridor: string | null, shopWide: DistanceBand | null, perCorridor?: CorridorCeilings | null): DistanceBand | null {
  if (corridor && perCorridor && perCorridor[corridor.toLowerCase()]) return perCorridor[corridor.toLowerCase()];
  return shopWide;
}

