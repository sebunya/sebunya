import { db } from '../db/client';
import { attributionTouchpoints } from '../db/schema/measurement';
import { eq, gte, sql } from 'drizzle-orm';
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
   * Aggregated in SQL (#19): it used to load every touchpoint row in the window
   * into memory to average one column. No rows -> null rates, never 0%.
   */
  async getMatchQualitySummary(days: number): Promise<MatchQualitySummary> {
    const since = new Date(Date.now() - days * 86_400_000);

    const [row] = await db
      .select({
        total: sql<number>`count(*)::int`,
        avg: sql<string | null>`avg(${attributionTouchpoints.matchScore})`,
        below40: sql<number>`count(*) filter (where ${attributionTouchpoints.matchScore} < 40)::int`,
        above80: sql<number>`count(*) filter (where ${attributionTouchpoints.matchScore} >= 80)::int`,
        hashedEmail: sql<number>`count(*) filter (where ${attributionTouchpoints.hasHashedEmail})::int`,
        hashedPhone: sql<number>`count(*) filter (where ${attributionTouchpoints.hasHashedPhone})::int`,
        fbp: sql<number>`count(*) filter (where ${attributionTouchpoints.hasFbp})::int`,
        fbc: sql<number>`count(*) filter (where ${attributionTouchpoints.hasFbc})::int`,
        gclid: sql<number>`count(*) filter (where ${attributionTouchpoints.hasGclid})::int`,
        ttclid: sql<number>`count(*) filter (where ${attributionTouchpoints.hasTtclid})::int`,
        ipAddress: sql<number>`count(*) filter (where ${attributionTouchpoints.hasIpAddress})::int`,
      })
      .from(attributionTouchpoints)
      .where(gte(attributionTouchpoints.eventTime, since));

    return summariseMatchQuality({
      total: Number(row?.total ?? 0),
      avg: row?.avg === null || row?.avg === undefined ? null : Number(row.avg),
      below40: Number(row?.below40 ?? 0),
      above80: Number(row?.above80 ?? 0),
      signals: Object.fromEntries(MATCH_SIGNALS.map((k) => [k, Number(row?.[k] ?? 0)])) as Record<MatchSignal, number>,
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
