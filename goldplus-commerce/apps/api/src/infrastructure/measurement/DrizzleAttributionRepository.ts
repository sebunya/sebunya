import { db } from '../db/client';
import { attributionTouchpoints } from '../db/schema/measurement';
import { eq, gte } from 'drizzle-orm';
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

  async getMatchQualitySummary(days: number): Promise<MatchQualitySummary> {
    const since = new Date(Date.now() - days * 86_400_000);

    const rows = await db
      .select({ matchScore: attributionTouchpoints.matchScore })
      .from(attributionTouchpoints)
      .where(gte(attributionTouchpoints.eventTime, since));

    if (rows.length === 0) {
      return { avgScore: 0, below40Pct: 0, above80Pct: 0, totalEvents: 0 };
    }

    const total = rows.length;
    const avg = rows.reduce((sum, r) => sum + r.matchScore, 0) / total;
    const below40 = rows.filter(r => r.matchScore < 40).length;
    const above80 = rows.filter(r => r.matchScore >= 80).length;

    return {
      avgScore: Math.round(avg * 10) / 10,
      below40Pct: Math.round((below40 / total) * 100),
      above80Pct: Math.round((above80 / total) * 100),
      totalEvents: total,
    };
  }
}
