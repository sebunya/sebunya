/**
 * The fee ladder (address system spec §4.5).
 *
 * The model turns minutes into cost; the ladder is how the FEE is presented:
 * a short list of price points the owner sets, and the model places each
 * destination on the lowest rung whose price covers modelled cost × margin.
 * A ladder is a quantisation of the model, not a second model: the rung is a
 * function of the same minutes the window comes from (contract #2). The model
 * never proposes prices (contract #4); it proposes placements and raises the
 * margin alarm when a rung stops covering its cost.
 *
 * Pure. No I/O.
 */

export const FEE_SHAPES = ['continuous', 'ladder'] as const;
export type FeeShape = (typeof FEE_SHAPES)[number];
export const LADDER_MIN_RUNGS = 2;
export const LADDER_MAX_RUNGS = 12;

/**
 * "3000, 5000, 8000, 12000, 20000" → [3000, 5000, 8000, 12000, 20000].
 * Null for anything that is not 2–12 distinct positive whole UGX amounts in
 * any order (they are sorted). Thousands separators and "UGX" are tolerated
 * because the owner types this into a box.
 */
export function parseFeeLadder(raw: string | null | undefined): number[] | null {
  if (typeof raw !== 'string') return null;
  const parts = raw
    .replace(/ugx/gi, ' ')
    .split(/[\s,;/|]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const rungs: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,9}$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isInteger(n) || n <= 0) return null;
    rungs.push(n);
  }
  const distinct = [...new Set(rungs)].sort((a, b) => a - b);
  if (distinct.length !== rungs.length) return null;
  if (distinct.length < LADDER_MIN_RUNGS || distinct.length > LADDER_MAX_RUNGS) return null;
  return distinct;
}

export interface LadderPlacement {
  rungUgx: number;
  /** False when even the top rung is below the cost the model worked out: the alarm case. */
  covered: boolean;
  rungIndex: number;
}

/** The lowest rung at or above the amount the continuous shape would charge. */
export function placeOnLadder(continuousFeeUgx: number, ladder: readonly number[]): LadderPlacement {
  for (let i = 0; i < ladder.length; i++) {
    if (ladder[i] >= continuousFeeUgx) return { rungUgx: ladder[i], covered: true, rungIndex: i };
  }
  const top = ladder.length - 1;
  return { rungUgx: ladder[top], covered: false, rungIndex: top };
}

export interface LadderPlacementRow {
  areaSlug: string;
  label: string;
  /** One-way km the quote used (band midpoint or measured), for the ordering check. */
  oneWayKm: number | null;
  currentFeeUgx: number | null;
  proposedRungUgx: number | null;
  covered: boolean;
}

/**
 * The dry-run rule from the review board (§16): a nearer area on a higher rung
 * than a farther one is listed, because customers compare. Pairs are reported
 * once, nearest first, capped so a 360-area ladder with one odd rung does not
 * print 300 lines.
 */
export function ladderOrderingFlags(rows: readonly LadderPlacementRow[], cap = 40): Array<{ nearer: string; farther: string; nearerKm: number; fartherKm: number; nearerFee: number; fartherFee: number }> {
  const placed = rows
    .filter((r) => r.oneWayKm !== null && r.proposedRungUgx !== null)
    .sort((a, b) => (a.oneWayKm as number) - (b.oneWayKm as number));
  const flags: Array<{ nearer: string; farther: string; nearerKm: number; fartherKm: number; nearerFee: number; fartherFee: number }> = [];
  for (let i = 0; i < placed.length && flags.length < cap; i++) {
    for (let j = i + 1; j < placed.length && flags.length < cap; j++) {
      const a = placed[i];
      const b = placed[j];
      if ((a.proposedRungUgx as number) > (b.proposedRungUgx as number)) {
        flags.push({ nearer: a.label, farther: b.label, nearerKm: a.oneWayKm as number, fartherKm: b.oneWayKm as number, nearerFee: a.proposedRungUgx as number, fartherFee: b.proposedRungUgx as number });
        break; // one partner per nearer area is enough to make the point
      }
    }
  }
  return flags;
}

export interface RungMargin {
  rungUgx: number;
  orders: number;
  /** Orders whose modelled cost × margin exceeded the rung's price. */
  overCost: number;
  overCostPct: number;
  /** Mean of (rung − modelled cost × margin), UGX; negative means the rung loses money on average. */
  meanHeadroomUgx: number | null;
  alarm: boolean;
}

/**
 * The margin alarm (§4.5): per rung, the share of orders where modelled
 * cost × margin exceeded the price. Fires above the owner's share. Pure: the
 * caller brings the capture rows and the current cost numbers.
 */
export function rungMargins(
  captures: ReadonlyArray<{ quotedFeeUgx: number | null; expectedMinutes: number | null }>,
  config: { riderCostPerMinuteUgx: number | null; marginMultiplier: number | null },
  ladder: readonly number[],
  alarmSharePct: number,
): RungMargin[] {
  const costPerMin = config.riderCostPerMinuteUgx;
  const margin = config.marginMultiplier;
  const byRung = new Map<number, { orders: number; over: number; headroom: number[] }>();
  for (const r of ladder) byRung.set(r, { orders: 0, over: 0, headroom: [] });
  for (const c of captures) {
    if (c.quotedFeeUgx === null || !byRung.has(c.quotedFeeUgx)) continue;
    const slot = byRung.get(c.quotedFeeUgx)!;
    slot.orders += 1;
    if (c.expectedMinutes === null || costPerMin === null || margin === null) continue;
    const modelled = c.expectedMinutes * costPerMin * margin;
    const headroom = c.quotedFeeUgx - modelled;
    slot.headroom.push(headroom);
    if (modelled > c.quotedFeeUgx) slot.over += 1;
  }
  return ladder.map((rung) => {
    const s = byRung.get(rung)!;
    const pct = s.orders > 0 ? Math.round((1000 * s.over) / s.orders) / 10 : 0;
    const mean = s.headroom.length > 0 ? Math.round(s.headroom.reduce((a, b) => a + b, 0) / s.headroom.length) : null;
    return { rungUgx: rung, orders: s.orders, overCost: s.over, overCostPct: pct, meanHeadroomUgx: mean, alarm: s.orders > 0 && pct > alarmSharePct };
  });
}
