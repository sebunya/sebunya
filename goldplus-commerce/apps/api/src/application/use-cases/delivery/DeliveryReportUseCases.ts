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
  /** 0189: the location-accuracy facts of the last 28 days of captures, in one row. */
  locationAccuracy(): Promise<LocationAccuracyRaw>;
}

/** What the repository returns; JSON columns may arrive parsed or as text depending on the driver. */
export interface LocationAccuracyRaw {
  quotes: number;
  model_priced: number;
  minutes_known: number;
  median_abs_minutes: string | number | null;
  first_attempt_ok: number;
  first_attempt_known: number;
  areas: number;
  areas_with_point: number;
  tiers: Array<{ tier: string | null; n: number }> | string | null;
  sources: Array<{ source: string | null; n: number }> | string | null;
}

export interface LocationAccuracyReport {
  windowDays: number;
  quotes: number;
  modelPricedPct: number | null;
  minutesKnown: number;
  medianAbsMinutes: number | null;
  firstAttemptKnown: number;
  firstAttemptPct: number | null;
  tiers: Array<{ tier: string; n: number; pct: number }>;
  sources: Array<{ source: string; n: number; pct: number }>;
  areas: number;
  areasWithPoint: number;
  note: string;
}

/**
 * Location accuracy (address system spec §0): the four numbers that say
 * whether better locations are making quotes better, from columns the capture
 * already has. Absence is reported in words, never as zero per cent.
 */
export class DeliveryLocationAccuracyReportUseCase {
  constructor(private readonly repo: Pick<IDeliveryReportRepository, 'locationAccuracy'>) {}

  async execute(): Promise<LocationAccuracyReport> {
    const raw = await this.repo.locationAccuracy();
    const parse = <T>(v: T[] | string | null | undefined): T[] =>
      Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? (JSON.parse(v) as T[]) : [];
    const quotes = Number(raw.quotes ?? 0);
    const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((1000 * n) / d) / 10 : null);
    const tiers = parse(raw.tiers)
      .map((t) => ({ tier: t.tier ?? 'unrecorded', n: Number(t.n ?? 0), pct: pct(Number(t.n ?? 0), quotes) ?? 0 }))
      .sort((a, b) => b.n - a.n);
    const sources = parse(raw.sources)
      .map((s) => ({ source: s.source ?? 'none', n: Number(s.n ?? 0), pct: pct(Number(s.n ?? 0), quotes) ?? 0 }))
      .sort((a, b) => b.n - a.n);
    const minutesKnown = Number(raw.minutes_known ?? 0);
    const median =
      raw.median_abs_minutes === null || raw.median_abs_minutes === undefined || !Number.isFinite(Number(raw.median_abs_minutes))
        ? null
        : Math.round(Number(raw.median_abs_minutes) * 10) / 10;
    const firstAttemptKnown = Number(raw.first_attempt_known ?? 0);
    const note =
      quotes === 0
        ? 'No quotes were captured in the last 28 days, so nothing can be said yet.'
        : minutesKnown === 0
          ? `${quotes} quote(s) captured, but no order has both an expected and an actual duration yet: the minutes error waits on deliveries being recorded with their time.`
          : `${quotes} quote(s) captured; ${minutesKnown} with both expected and actual minutes; ${firstAttemptKnown} with a recorded first attempt.`;
    return {
      windowDays: 28,
      quotes,
      modelPricedPct: pct(Number(raw.model_priced ?? 0), quotes),
      minutesKnown,
      medianAbsMinutes: median,
      firstAttemptKnown,
      firstAttemptPct: pct(Number(raw.first_attempt_ok ?? 0), firstAttemptKnown),
      tiers,
      sources,
      areas: Number(raw.areas ?? 0),
      areasWithPoint: Number(raw.areas_with_point ?? 0),
      note,
    };
  }
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
