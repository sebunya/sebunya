/**
 * The fee ladder's two owner-facing tools (spec §4.5):
 *
 * - the DRY RUN: which area lands on which rung under a proposed ladder, next
 *   to the fee it is charged today, with the ordering flags the review board
 *   asked for (a nearer area on a higher rung than a farther one). It writes
 *   nothing; the owner publishes fee_shape / fee_ladder through the ordinary
 *   configuration draft → publish path, so the change is versioned and
 *   revertible like every other value.
 * - the MARGIN ALARM: per rung, the share of the last 28 days' orders whose
 *   modelled cost × margin exceeded the rung's price.
 *
 * The model never proposes prices (contract #4). These show consequences.
 */
import { ladderOrderingFlags, parseFeeLadder, rungMargins, type LadderPlacementRow, type RungMargin } from '../../../domain/delivery/DeliveryFeeLadder';
import type { DeliveryQuotingUseCase } from './DeliveryQuotingUseCase';

export interface IOwnRiderAreaList {
  /** Every serviceable own-rider area in the corridor set, with its label. */
  ownRiderAreas(): Promise<Array<{ areaSlug: string; label: string }>>;
}

export interface ILadderMarginSource {
  /** The last 28 days of own-rider captures priced by the model: the fee charged and the minutes the model expected. */
  ladderCaptures(): Promise<Array<{ quotedFeeUgx: number | null; expectedMinutes: number | null }>>;
}

export type LadderDryRunResult =
  | { ok: false; code: 'BAD_LADDER'; message: string }
  | {
      ok: true;
      ladder: number[];
      rows: LadderPlacementRow[];
      changed: number;
      uncovered: number;
      orderingFlags: ReturnType<typeof ladderOrderingFlags>;
      summary: string;
    };

export class LadderDryRunUseCase {
  constructor(
    private readonly areas: IOwnRiderAreaList,
    private readonly quoting: Pick<DeliveryQuotingUseCase, 'execute'>,
  ) {}

  async execute(input: { ladder: string }): Promise<LadderDryRunResult> {
    const ladder = parseFeeLadder(input.ladder);
    if (!ladder) {
      return { ok: false, code: 'BAD_LADDER', message: 'Give two to twelve whole UGX amounts, e.g. "3000, 5000, 8000, 12000, 20000".' };
    }
    const areas = await this.areas.ownRiderAreas();
    const at = new Date();
    const rows: LadderPlacementRow[] = [];
    for (const a of areas) {
      const [current, proposed] = await Promise.all([
        this.quoting.execute({ areaSlug: a.areaSlug, items: [], at }),
        this.quoting.execute({ areaSlug: a.areaSlug, items: [], at, feeShapeOverride: 'ladder', feeLadderOverride: ladder }),
      ]);
      const cur = current.quote.kind === 'rider_delivery' ? current.quote : null;
      const prop = proposed.quote.kind === 'rider_delivery' ? proposed.quote : null;
      rows.push({
        areaSlug: a.areaSlug,
        label: a.label,
        oneWayKm: prop?.explanation.oneWayKm ?? cur?.explanation.oneWayKm ?? null,
        currentFeeUgx: cur ? cur.feeUgx : null,
        proposedRungUgx: prop ? prop.feeUgx : null,
        covered: prop ? prop.explanation.ladderCovered !== false : true,
      });
    }
    const changed = rows.filter((r) => r.currentFeeUgx !== null && r.proposedRungUgx !== null && r.currentFeeUgx !== r.proposedRungUgx).length;
    const uncovered = rows.filter((r) => !r.covered).length;
    const orderingFlags = ladderOrderingFlags(rows);
    const quotable = rows.filter((r) => r.proposedRungUgx !== null).length;
    const summary =
      quotable === 0
        ? 'No area can be priced yet (the launch values are not all set), so nothing can be placed on a ladder.'
        : `${quotable} area(s) placed on ${ladder.length} rungs; ${changed} would change fee; ${uncovered} sit above the top rung (the model's cost exceeds UGX ${ladder[ladder.length - 1].toLocaleString('en-UG')}); ${orderingFlags.length} ordering flag(s).`;
    return { ok: true, ladder, rows: rows.sort((a, b) => (a.oneWayKm ?? 1e9) - (b.oneWayKm ?? 1e9)), changed, uncovered, orderingFlags, summary };
  }
}

export interface LadderMarginReport {
  shape: 'continuous' | 'ladder';
  ladder: number[] | null;
  alarmSharePct: number;
  rungs: RungMargin[];
  alarms: number;
  note: string;
}

export class LadderMarginReportUseCase {
  constructor(
    private readonly source: ILadderMarginSource,
    private readonly config: { currentValues(): Promise<Record<string, string>>; numericValues(): Promise<Record<string, number>> },
  ) {}

  async execute(): Promise<LadderMarginReport> {
    const [raw, numeric] = await Promise.all([this.config.currentValues(), this.config.numericValues()]);
    const ladder = parseFeeLadder(raw.fee_ladder);
    const shape = raw.fee_shape === 'ladder' && ladder ? 'ladder' : 'continuous';
    const alarmSharePct = Number.isFinite(numeric.ladder_margin_alarm_pct) ? numeric.ladder_margin_alarm_pct : 10;
    if (shape !== 'ladder' || !ladder) {
      return { shape, ladder, alarmSharePct, rungs: [], alarms: 0, note: 'The fee shape is continuous, so there are no rungs to watch.' };
    }
    const captures = await this.source.ladderCaptures();
    const rungs = rungMargins(
      captures,
      { riderCostPerMinuteUgx: numeric.rider_cost_per_minute_ugx ?? null, marginMultiplier: numeric.margin_multiplier ?? null },
      ladder,
      alarmSharePct,
    );
    const alarms = rungs.filter((r) => r.alarm).length;
    const orders = rungs.reduce((n, r) => n + r.orders, 0);
    const note =
      orders === 0
        ? 'No model-priced order in the last 28 days landed on a rung yet.'
        : alarms === 0
          ? `${orders} order(s) on the ladder in the last 28 days; every rung covered its modelled cost in at least ${100 - alarmSharePct}% of its orders.`
          : `${alarms} rung(s) had modelled cost × margin above the price in more than ${alarmSharePct}% of orders: add a rung there or move to continuous.`;
    return { shape, ladder, alarmSharePct, rungs, alarms, note };
  }
}
