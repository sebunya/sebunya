import { db } from '../db/client';
import { attributionTouchpoints } from '../db/schema/measurement';
import { eq, sql } from 'drizzle-orm';
import { environmentOf } from '../../domain/measurement/BusinessEvents';
import { MATCH_SIGNALS } from '../../application/ports/measurement/AttributionRepository';
import type { AttributionRepository, AttributionTouchpointRow, MatchQualitySummary, MatchSignal } from '../../application/ports/measurement/AttributionRepository';

export class DrizzleAttributionRepository implements AttributionRepository {
  async getTouchpointsByOrderId(orderId: string): Promise<AttributionTouchpointRow[]> {
    const rows = await db
      .select()
      .from(attributionTouchpoints)
      .where(eq(attributionTouchpoints.orderId, orderId))
      .orderBy(attributionTouchpoints.eventTime);

    return rows.map(r => ({
      id: r.id,
      eventName: r.eventName,
      eventTime: r.eventTime,
      matchScore: r.matchScore,
      routedDestinations: r.routedDestinations as string[] | null,
      blockedDestinations: r.blockedDestinations as string[] | null,
      hasHashedEmail: r.hasHashedEmail,
      hasHashedPhone: r.hasHashedPhone,
      hasFbp: r.hasFbp,
      hasFbc: r.hasFbc,
      hasGclid: r.hasGclid,
      hasTtclid: r.hasTtclid,
      hasIpAddress: r.hasIpAddress,
    }));
  }

  /**
   * Match quality from the LIVE tables (2026-10-23). It used to read public.attribution_touchpoints, which nothing
   * has ever written (its writer, ConversionRouter.routeAndRecord, has no caller), so the card said "No data" for
   * ever. Now: one row per confirmed sale in the window; a signal is present when the order carries it (email,
   * phone, a browser id for fbp, click ids, the checkout IP). Score = the weights of the signals present, so an
   * order with email + phone + IP scores 60 and one that also arrived from an ad click scores 80 or more.
   */
  async getMatchQualitySummary(days: number): Promise<MatchQualitySummary> {
    const r = (await db.execute(sql`
      with o as (
        select e.event_id, oa.fp_client_id, oa.client_ip, coalesce(oa.click_ids, '{}'::jsonb) as ck, ord.customer_email, ord.customer_phone
        from measurement.business_event e
        left join orders ord on ord.id::text = e.aggregate_id
        left join order_attribution oa on oa.order_id = ord.id
        where e.event_name = 'order_confirmed' and e.environment = ${environmentOf(process.env.NODE_ENV)} and e.occurred_at >= now() - make_interval(days => ${days})
      ), s as (
        select (customer_email is not null and customer_email <> '') as has_email, (customer_phone is not null and customer_phone <> '') as has_phone,
               (fp_client_id is not null) as has_fbp, (ck ? 'fbc') as has_fbc, (ck ? 'gclid' or ck ? 'gbraid' or ck ? 'wbraid') as has_gclid, (ck ? 'ttclid') as has_ttclid, (client_ip is not null) as has_ip
        from o
      ), scored as (
        select *, (case when has_email then 25 else 0 end + case when has_phone then 25 else 0 end + case when has_ip then 10 else 0 end + case when has_fbp then 10 else 0 end
                 + case when has_fbc then 15 else 0 end + case when has_gclid then 20 else 0 end + case when has_ttclid then 15 else 0 end) as score from s
      )
      select count(*)::int as total, avg(least(score, 100)) as avg, count(*) filter (where score < 40)::int as below40, count(*) filter (where score >= 80)::int as above80,
             count(*) filter (where has_email)::int as "hashedEmail", count(*) filter (where has_phone)::int as "hashedPhone", count(*) filter (where has_fbp)::int as fbp,
             count(*) filter (where has_fbc)::int as fbc, count(*) filter (where has_gclid)::int as gclid, count(*) filter (where has_ttclid)::int as ttclid, count(*) filter (where has_ip)::int as "ipAddress"
      from scored`)) as unknown;
    const row: Record<string, unknown> = (Array.isArray(r) ? r : ((r as { rows?: Array<Record<string, unknown>> }).rows ?? []))[0] ?? {};
    return summariseMatchQuality({
      total: Number(row.total ?? 0),
      avg: row.avg === null || row.avg === undefined ? null : Number(row.avg),
      below40: Number(row.below40 ?? 0),
      above80: Number(row.above80 ?? 0),
      signals: Object.fromEntries(MATCH_SIGNALS.map((k) => [k, Number(row[k] ?? 0)])) as Record<MatchSignal, number>,
    });
  }
}

/** Pure shaping of the SQL aggregate; exported for tests. */
export function summariseMatchQuality(agg: {
  total: number;
  avg: number | null;
  below40: number;
  above80: number;
  signals?: Partial<Record<MatchSignal, number>>;
}): MatchQualitySummary {
  if (!agg.total || agg.avg === null || !Number.isFinite(agg.avg)) {
    return {
      avgScore: null, below40Pct: null, above80Pct: null,
      below40Count: 0, above80Count: 0, totalEvents: 0,
      signalCoverage: Object.fromEntries(MATCH_SIGNALS.map((k) => [k, null])) as Record<MatchSignal, number | null>,
    };
  }
  const pct = (n: number) => Math.round((n / agg.total) * 100);
  return {
    avgScore: Math.round(agg.avg * 10) / 10,
    below40Pct: pct(agg.below40),
    above80Pct: pct(agg.above80),
    below40Count: agg.below40,
    above80Count: agg.above80,
    totalEvents: agg.total,
    signalCoverage: Object.fromEntries(MATCH_SIGNALS.map((k) => [k, pct(agg.signals?.[k] ?? 0)])) as Record<MatchSignal, number | null>,
  };
}
