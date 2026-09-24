import { db } from '../db/client';
import { attributionTouchpoints } from '../db/schema/measurement';
import { eq, gte, sql } from 'drizzle-orm';
import type { AttributionRepository, AttributionTouchpointRow, MatchQualitySummary } from '../../application/ports/measurement/AttributionRepository';

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
      })
      .from(attributionTouchpoints)
      .where(gte(attributionTouchpoints.eventTime, since));

    return summariseMatchQuality({
      total: Number(row?.total ?? 0),
      avg: row?.avg === null || row?.avg === undefined ? null : Number(row.avg),
      below40: Number(row?.below40 ?? 0),
      above80: Number(row?.above80 ?? 0),
    });
  }
}

/** Pure shaping of the SQL aggregate; exported for tests. */
export function summariseMatchQuality(agg: { total: number; avg: number | null; below40: number; above80: number }): MatchQualitySummary {
  if (!agg.total || agg.avg === null || !Number.isFinite(agg.avg)) {
    return { avgScore: null, below40Pct: null, above80Pct: null, totalEvents: 0 };
  }
  return {
    avgScore: Math.round(agg.avg * 10) / 10,
    below40Pct: Math.round((agg.below40 / agg.total) * 100),
    above80Pct: Math.round((agg.above80 / agg.total) * 100),
    totalEvents: agg.total,
  };
}
