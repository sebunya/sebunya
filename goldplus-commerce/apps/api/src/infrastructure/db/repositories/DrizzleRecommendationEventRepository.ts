import { and, desc, eq, gte, sql } from "drizzle-orm";
import { RecommendationEvent } from "../../../domain/recommendations/RecommendationEvent";
import type {
  IRecommendationEventRepository,
  RecentEventQuery,
  TrendingEventAggregate,
} from "../../../application/ports/IRecommendationEventRepository";
import { recommendationEvents } from "../schema/recommendations";
import { db } from "../client";

export class DrizzleRecommendationEventRepository implements IRecommendationEventRepository {
  async save(event: RecommendationEvent): Promise<void> {
    await db.insert(recommendationEvents).values({
      id: event.id,
      eventType: event.eventType,
      anonymousId: event.anonymousId,
      customerId: event.customerId,
      sessionId: event.sessionId,
      productId: event.productId,
      categoryId: event.categoryId,
      searchQuery: event.searchQuery,
      placement: event.placement,
      recommendationProductId: event.recommendationProductId,
      source: event.source,
      metadata: event.metadata,
      createdAt: event.createdAt,
    });
  }

  async existsRecentSimilarEvent(query: RecentEventQuery): Promise<boolean> {
    const conditions = [];

    if (query.eventType) conditions.push(eq(recommendationEvents.eventType, query.eventType));
    if (query.productId) conditions.push(eq(recommendationEvents.productId, query.productId));
    if (query.recommendationProductId) conditions.push(eq(recommendationEvents.recommendationProductId, query.recommendationProductId));
    if (query.placement) conditions.push(eq(recommendationEvents.placement, query.placement));
    if (query.anonymousId) conditions.push(eq(recommendationEvents.anonymousId, query.anonymousId));
    if (query.customerId) conditions.push(eq(recommendationEvents.customerId, query.customerId));

    if (query.withinMinutes) {
      const since = new Date(Date.now() - query.withinMinutes * 60_000);
      conditions.push(gte(recommendationEvents.createdAt, since));
    }

    if (conditions.length === 0) return false;

    const rows = await db
      .select({ id: recommendationEvents.id })
      .from(recommendationEvents)
      .where(and(...conditions))
      .limit(1);

    return rows.length > 0;
  }

  async findRecentlyViewed(input: {
    anonymousId?: string;
    customerId?: string;
    limit: number;
  }): Promise<Array<{ productId: string; viewedAt: Date }>> {
    const identityConditions = [];

    if (input.anonymousId) {
      identityConditions.push(eq(recommendationEvents.anonymousId, input.anonymousId));
    }

    if (input.customerId) {
      identityConditions.push(eq(recommendationEvents.customerId, input.customerId));
    }

    if (identityConditions.length === 0) return [];

    const rows = await db
      .select({
        productId: recommendationEvents.productId,
        viewedAt: recommendationEvents.createdAt,
      })
      .from(recommendationEvents)
      .where(
        and(
          eq(recommendationEvents.eventType, "PRODUCT_VIEWED"),
          identityConditions.length === 1
            ? identityConditions[0]
            : sql`(${identityConditions[0]} OR ${identityConditions[1]})`,
        ),
      )
      .orderBy(desc(recommendationEvents.createdAt))
      .limit(Math.max(input.limit * 3, input.limit));

    const seen = new Set<string>();
    const deduped: Array<{ productId: string; viewedAt: Date }> = [];

    for (const row of rows) {
      if (!row.productId || seen.has(row.productId)) continue;
      seen.add(row.productId);
      deduped.push({ productId: row.productId, viewedAt: row.viewedAt });
      if (deduped.length >= input.limit) break;
    }

    return deduped;
  }

  async getTrendingEvents(input: {
    since: Date;
    limit?: number;
  }): Promise<TrendingEventAggregate[]> {
    const rows = await db
      .select({
        productId: recommendationEvents.productId,
        eventType: recommendationEvents.eventType,
        count: sql<number>`count(*)::int`,
        lastSeenAt: sql<Date>`max(${recommendationEvents.createdAt})`,
      })
      .from(recommendationEvents)
      .where(gte(recommendationEvents.createdAt, input.since))
      .groupBy(recommendationEvents.productId, recommendationEvents.eventType)
      .limit(input.limit ?? 500);

    return rows
      .filter((row) => row.productId)
      .map((row) => ({
        productId: row.productId as string,
        eventType: row.eventType as TrendingEventAggregate["eventType"],
        count: Number(row.count),
        lastSeenAt: row.lastSeenAt,
      }));
  }
}
