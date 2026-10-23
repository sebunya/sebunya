import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logging/logger';
import type { Ga4Reporter } from './Ga4DataApi';

/**
 * The shop's own copy of GA4's daily series (0205, 2026-10-23): sessions, users and purchases per day by channel
 * group, source/medium, landing page and device, pulled from the GA4 Data API into measurement.ga4_daily_series.
 * Why a copy: the BigQuery export sits in a sandbox project whose tables expire after 60 days, and the model
 * only needs daily aggregates, which GA4 keeps as standard reports beyond its event retention. Owning the rows
 * means the history survives both.
 *
 * First run (empty table): the whole MMM window (400 days). Every later run: the last three days, because GA4
 * fills a day in for up to 48 hours. A missing credential or a refused call writes nothing and is reported in the
 * nightly stats as "unavailable"; rows already held are never touched by a failed pull.
 */
export const GA4_REPORTS = {
  channel: 'sessionDefaultChannelGroup',
  source_medium: 'sessionSourceMedium',
  landing_page: 'landingPage',
  device: 'deviceCategory',
} as const;
export type Ga4ReportKey = keyof typeof GA4_REPORTS;
const METRICS = ['sessions', 'totalUsers', 'newUsers', 'engagedSessions', 'keyEvents', 'ecommercePurchases', 'purchaseRevenue'] as const;
export const GA4_BACKFILL_DAYS = 400;
export const GA4_REFRESH_DAYS = 3;
const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

export interface Ga4PullResult { from: string; to: string; mode: 'backfill' | 'refresh'; rows: number; reports: Partial<Record<Ga4ReportKey, number | { error: string }>>; unavailable: string | null }
export interface Ga4SeriesSummary { lastDay: string | null; days: number; rows: number; lastFetchedAt: string | null }

export class Ga4DailyPull {
  constructor(private readonly ga4: Ga4Reporter) {}

  async run(now = new Date(), backfillDays = GA4_BACKFILL_DAYS): Promise<Ga4PullResult> {
    const held = rows(await db.execute(sql`select max(day)::text as last_day from measurement.ga4_daily_series`))[0];
    const mode: Ga4PullResult['mode'] = held?.last_day ? 'refresh' : 'backfill';
    // GA4 reports in the property's time zone (Africa/Kampala); the day asked for is the Kampala calendar day.
    const to = kday(new Date(now.getTime() - 86_400_000));
    const from = kday(new Date(now.getTime() - (mode === 'backfill' ? backfillDays : GA4_REFRESH_DAYS) * 86_400_000));
    const out: Ga4PullResult = { from, to, mode, rows: 0, reports: {}, unavailable: null };
    for (const key of Object.keys(GA4_REPORTS) as Ga4ReportKey[]) {
      try {
        const r = await this.ga4.runReport({ dateRanges: [{ startDate: from, endDate: to }], dimensions: [{ name: 'date' }, { name: GA4_REPORTS[key] }], metrics: METRICS.map((name) => ({ name })) });
        if ('unavailable' in r) { out.unavailable = r.unavailable; break; } // the same credential serves every report: stop, do not spam Google
        const n = await this.store(key, r.rows, now);
        out.reports[key] = n; out.rows += n;
      } catch (err) {
        out.reports[key] = { error: String((err as Error).message ?? err).slice(0, 200) };
        logger.warn({ err: (err as Error).message, report: key }, '[ga4-series] report failed');
      }
    }
    return out;
  }

  private async store(report: Ga4ReportKey, reportRows: Array<{ dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }>, now: Date): Promise<number> {
    let n = 0;
    await db.transaction(async (tx) => {
      for (const r of reportRows) {
        const d = r.dimensionValues[0]?.value ?? '';
        if (!/^\d{8}$/.test(d)) continue;
        const day = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
        const dimension = (r.dimensionValues[1]?.value ?? '(not set)').slice(0, 200) || '(not set)';
        const m = r.metricValues.map((v) => Number(v.value) || 0);
        await tx.execute(sql`insert into measurement.ga4_daily_series (day, report, dimension, sessions, total_users, new_users, engaged_sessions, key_events, purchases, purchase_revenue_minor, fetched_at)
          values (${day}::date, ${report}, ${dimension}, ${Math.round(m[0])}, ${Math.round(m[1])}, ${Math.round(m[2])}, ${Math.round(m[3])}, ${Math.round(m[4])}, ${Math.round(m[5])}, ${String(Math.round(m[6]))}::bigint, ${now})
          on conflict (day, report, dimension) do update set sessions = excluded.sessions, total_users = excluded.total_users, new_users = excluded.new_users, engaged_sessions = excluded.engaged_sessions,
            key_events = excluded.key_events, purchases = excluded.purchases, purchase_revenue_minor = excluded.purchase_revenue_minor, fetched_at = excluded.fetched_at`);
        n++;
      }
    });
    return n;
  }

  async summary(): Promise<Ga4SeriesSummary> {
    const r = rows(await db.execute(sql`select max(day)::text as last_day, count(distinct day)::int as days, count(*)::int as rows, max(fetched_at) as fetched_at from measurement.ga4_daily_series`))[0];
    return { lastDay: r?.last_day ? String(r.last_day) : null, days: Number(r?.days ?? 0), rows: Number(r?.rows ?? 0), lastFetchedAt: r?.fetched_at ? new Date(r.fetched_at).toISOString() : null };
  }

  /** One report over a window, for the admin page and the dataset: rows per day and dimension value. */
  async series(report: Ga4ReportKey, days = 28): Promise<Array<{ day: string; dimension: string; sessions: number; totalUsers: number; newUsers: number; engagedSessions: number; keyEvents: number; purchases: number; purchaseRevenueUGX: number }>> {
    if (!(report in GA4_REPORTS)) return [];
    return rows(await db.execute(sql`select day::text as day, dimension, sessions, total_users, new_users, engaged_sessions, key_events, purchases, purchase_revenue_minor
      from measurement.ga4_daily_series where report = ${report} and day >= current_date - ${days}::int order by day desc, sessions desc`))
      .map((r) => ({ day: String(r.day), dimension: String(r.dimension), sessions: Number(r.sessions), totalUsers: Number(r.total_users), newUsers: Number(r.new_users), engagedSessions: Number(r.engaged_sessions), keyEvents: Number(r.key_events), purchases: Number(r.purchases), purchaseRevenueUGX: Number(r.purchase_revenue_minor) }));
  }
}

const kday = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
