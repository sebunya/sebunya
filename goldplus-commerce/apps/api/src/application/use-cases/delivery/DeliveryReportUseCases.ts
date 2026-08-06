import { EmptyExplanation, explainEmptiness } from '../../../domain/delivery/DeliveryCalibration';

/**
 * The delivery reports (brief PART 4, stage D).
 *
 * EVERY REPORT RENDERS ITS OWN EMPTINESS IN WORDS. "0 observations, 0 delivered
 * orders, threshold unset, nothing to propose" is a useful screen. A blank
 * table is a support ticket.
 *
 * So each report carries three things when it has no rows: what exists, what is
 * missing, and what would have to be true for it to say something. That is the
 * difference between a report that is empty and a report that is broken, and a
 * reader must never have to guess which one they are looking at.
 */

export interface MarginRow {
  areaSlug: string | null;
  deliveries: number;
  chargedUgx: number;
  costUgx: number;
  marginUgx: number;
  /** Null when nothing was charged — never a division by zero. */
  marginPct: number | null;
}

export interface VarianceRow {
  reason: string;
  count: number;
  absorbedCount: number;
  absorbedUgx: number;
  needsAgreementCount: number;
  agreedCount: number;
  declinedCount: number;
  totalDeltaUgx: number;
}

export interface IDeliveryReportRepository {
  marginByArea(): Promise<Array<{ area_slug: string | null; deliveries: number; charged_ugx: string | number | null; cost_ugx: string | number | null }>>;
  varianceByReason(): Promise<Array<Record<string, unknown>>>;
  counts(): Promise<{ observations: number; deliveredOrders: number; riderCostsRecorded: number; skippedMirrors: number }>;
  /** Quotes by which mechanism priced them, for the fallback rate. */
  pricedByBreakdown(): Promise<Array<{ priced_by: string | null; n: number }>>;
}

export interface DeliveryReport<T> {
  rows: T[];
  /** Null when there ARE rows. Non-null is the explanation, in words. */
  emptiness: (EmptyExplanation & { headline: string }) | null;
  counts: { observations: number; deliveredOrders: number; riderCostsRecorded: number; skippedMirrors: number };
}

export class DeliveryMarginReportUseCase {
  constructor(
    private readonly repo: IDeliveryReportRepository,
    private readonly config: () => Promise<Record<string, number>>,
  ) {}

  async execute(): Promise<DeliveryReport<MarginRow>> {
    const [raw, counts, numeric] = await Promise.all([this.repo.marginByArea(), this.repo.counts(), this.config()]);
    const rows: MarginRow[] = raw.map((r) => {
      const charged = Number(r.charged_ugx ?? 0);
      const cost = Number(r.cost_ugx ?? 0);
      return {
        areaSlug: r.area_slug,
        deliveries: r.deliveries,
        chargedUgx: charged,
        costUgx: cost,
        marginUgx: charged - cost,
        // Guarded: a zero charge is a real possibility (free delivery) and
        // dividing by it would produce Infinity in a money report.
        marginPct: charged > 0 ? ((charged - cost) / charged) * 100 : null,
      };
    });
    const minSample = Number.isFinite(numeric.calibration_min_sample_size) ? numeric.calibration_min_sample_size : null;
    const emptiness =
      rows.length > 0
        ? null
        : {
            ...explainEmptiness({ ...counts, minSample })!,
            headline:
              'No margin can be reported yet, because margin is quoted fee against what a rider was actually paid and neither exists.',
          };
    return { rows, emptiness, counts };
  }
}

export class DeliveryVarianceReportUseCase {
  constructor(
    private readonly repo: IDeliveryReportRepository,
    private readonly config: () => Promise<Record<string, number>>,
  ) {}

  async execute(): Promise<DeliveryReport<VarianceRow>> {
    const [raw, counts, numeric] = await Promise.all([this.repo.varianceByReason(), this.repo.counts(), this.config()]);
    const rows: VarianceRow[] = raw.map((r) => ({
      reason: String(r.reason),
      count: Number(r.n ?? 0),
      absorbedCount: Number(r.absorbed ?? 0),
      absorbedUgx: Number(r.absorbed_ugx ?? 0),
      needsAgreementCount: Number(r.needs_agreement ?? 0),
      agreedCount: Number(r.agreed ?? 0),
      declinedCount: Number(r.declined ?? 0),
      totalDeltaUgx: Number(r.total_delta ?? 0),
    }));
    const minSample = Number.isFinite(numeric.calibration_min_sample_size) ? numeric.calibration_min_sample_size : null;
    const emptiness =
      rows.length > 0
        ? null
        : {
            ...(explainEmptiness({ ...counts, minSample }) ?? {
              has: 'no variances',
              missing: 'nothing',
              needs: 'a placed order whose fee changed for one of the five permitted reasons',
            }),
            headline:
              'No quote has changed after placement. That is the good outcome, not a gap — falling variance over time is the honest proof this is working.',
          };
    return { rows, emptiness, counts };
  }
}

/**
 * The fallback rate.
 *
 * Goes to zero when the wizard is run, and the legacy paths are deleted once it
 * has been zero for the agreed period. This is the evidence for that deletion,
 * so it is a first-class report rather than a log line.
 */
export class DeliveryFallbackRateUseCase {
  constructor(private readonly repo: IDeliveryReportRepository) {}

  async execute() {
    const [breakdown, counts] = await Promise.all([this.repo.pricedByBreakdown(), this.repo.counts()]);
    const total = breakdown.reduce((n, b) => n + Number(b.n ?? 0), 0);
    const byPath = Object.fromEntries(breakdown.map((b) => [b.priced_by ?? 'unrecorded', Number(b.n ?? 0)]));
    const fallback = Number(byPath.legacy_fallback ?? 0);
    return {
      total,
      byPath,
      fallbackCount: fallback,
      // Guarded: no quotes at all is 0%, not NaN%.
      fallbackPct: total > 0 ? (fallback / total) * 100 : 0,
      note:
        total === 0
          ? 'No quote has been captured yet, so there is no fallback rate to report. The rate becomes meaningful with the first order placed after the quoting service went live.'
          : fallback === 0
            ? 'The legacy fallback has served zero requests. It can be deleted once it has stayed at zero for the agreed period.'
            : 'The legacy path is still answering. It stops the moment the launch values are published.',
      counts,
    };
  }
}
