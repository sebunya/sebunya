import { gte, sql } from 'drizzle-orm';
import { db } from '../client';
import { recommendationEvents } from '../schema/recommendations';
import {
  IRecommendationEventRepository,
  RecommendationEventInput,
  SurfacePerformanceRow,
} from '../../../application/ports/IRecommendationAdminRepositories';

export class DrizzleRecommendationEventRepository implements IRecommendationEventRepository {
  async record(input: RecommendationEventInput): Promise<void> {
    await db.insert(recommendationEvents).values({
      eventType: input.eventType,
      surface: input.surface,
      recommendationId: input.recommendationId ?? null,
      algorithmVersion: input.algorithmVersion ?? null,
      productId: input.productId ?? null,
      anchorProductId: input.anchorProductId ?? null,
      rank: input.rank ?? null,
      score: input.score ?? null,
      reasonCode: input.reasonCode ?? null,
      experimentKey: input.experimentKey ?? null,
      experimentVariant: input.experimentVariant ?? null,
      visitorId: input.visitorId ?? null,
      userId: input.userId ?? null,
      sessionId: input.sessionId ?? null,
    });
  }

  async surfacePerformanceSince(since: Date): Promise<SurfacePerformanceRow[]> {
    const t = recommendationEvents;
    const rows = await db
      .select({
        surface: t.surface,
        impressions: sql<number>`count(*) filter (where ${t.eventType} = 'impression')::int`,
        clicks: sql<number>`count(*) filter (where ${t.eventType} = 'click')::int`,
        addToCarts: sql<number>`count(*) filter (where ${t.eventType} = 'add_to_cart')::int`,
        purchases: sql<number>`count(*) filter (where ${t.eventType} = 'purchase')::int`,
      })
      .from(t)
      .where(gte(t.createdAt, since))
      .groupBy(t.surface);
    return rows.map((r) => ({
      surface: r.surface,
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      addToCarts: Number(r.addToCarts),
      purchases: Number(r.purchases),
    }));
  }
}
