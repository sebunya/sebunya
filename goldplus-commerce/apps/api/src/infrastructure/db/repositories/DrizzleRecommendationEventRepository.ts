import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { RecommendationEvent } from "../../../domain/recommendations/RecommendationEvent";
import type {
  IRecommendationEventRepository,
  RecentEventQuery,
  TrendingEventAggregate,
} from "../../../application/ports/IRecommendationEventRepository";
import { recommendationEvents } from "../schema/recommendations";
import { db } from "../client";

export class DrizzleRecommendationEventRepository implements IRecommendationEventRepository {
  /**
   * Contract v2 (R1): the insert is idempotent at the database. A row with a
   * dedupe_key that already exists is silently absorbed by the partial UNIQUE
   * index (`onConflictDoNothing`), so a beacon retry or replay produces one
   * event even when two replicas race — the app-level window check in the use
   * case is a fast-path, not the guarantee. Returns false when absorbed.
   */
  async save(event: RecommendationEvent): Promise<boolean> {
    const inserted = await db.insert(recommendationEvents).values([{
      id: event.id,
      eventType: event.eventType,
      anonymousId: event.anonymousId,
      browserId: event.browserId,
      sessionId: event.sessionId,
      cartId: event.cartId,
      customerId: event.customerId,
      leadId: event.leadId,
      
      // Attribution
      ruleId: event.ruleId,
      attributionId: event.attributionId,
      impressionId: event.impressionId,
      railRenderId: event.railRenderId,
      reasonCode: event.reasonCode,
      // R3.1 (M3): same canonical-jsonb treatment as metadata — the drizzle
      // mapping double-encoded this array on every historic row.
      appliedRuleIds: (event.appliedRuleIds ? sql`${event.appliedRuleIds}::jsonb` : null) as never,

      // Context
      productId: event.productId,
      categoryId: event.categoryId,
      searchQuery: event.searchQuery,
      placement: event.placement,
      recommendationProductId: event.recommendationProductId,
      sourceProductId: event.sourceProductId,
      source: event.source,
      pagePath: event.pagePath,
      referrer: event.referrer,

      // Flatten UTM
      utmSource: event.utm?.source,
      utmMedium: event.utm?.medium,
      utmCampaign: event.utm?.campaign,
      utmContent: event.utm?.content,
      utmTerm: event.utm?.term,

      // Flatten Device
      deviceType: event.device?.deviceType,
      browserFamily: event.device?.browserFamily,
      osFamily: event.device?.osFamily,
      screenWidth: event.device?.screenWidth,
      screenHeight: event.device?.screenHeight,
      viewportWidth: event.device?.viewportWidth,
      viewportHeight: event.device?.viewportHeight,
      language: event.device?.language,
      timezone: event.device?.timezone,

      // Flatten Location
      locationSource: event.location?.locationSource,
      district: event.location?.district,
      town: event.location?.town,
      gpsGeohash: event.location?.gpsGeohash,
      gpsAccuracyMeters: event.location?.gpsAccuracyMeters,

      // R3.1 (AC21): canonical JSONB at the serialization boundary. Drizzle
      // stringifies jsonb values and postgres.js then JSON-serializes the
      // param AGAIN — the double encoding. An SQL fragment carrying the RAW
      // OBJECT bypasses drizzle's mapping, so postgres.js serializes exactly
      // once and a real jsonb object lands (proven by driver probe + the
      // real-PG round-trip test). Readers keep their transition tolerance for
      // historic string-typed rows (AC22).
      metadata: sql`${event.metadata ?? {}}::jsonb` as never,
      createdAt: event.createdAt,

      // Contract v2 (0099)
      dedupeKey: event.dedupeKey,
      schemaVersion: event.schemaVersion,
      producer: event.producer,
      profileId: event.profileId,
    }]).onConflictDoNothing().returning({ id: recommendationEvents.id });
    return inserted.length > 0;
  }

  async existsRecentSimilarEvent(query: RecentEventQuery): Promise<boolean> {
    const conditions = [];

    if (query.eventType) conditions.push(eq(recommendationEvents.eventType, query.eventType));
    if (query.productId) conditions.push(eq(recommendationEvents.productId, query.productId));
    if (query.recommendationProductId) conditions.push(eq(recommendationEvents.recommendationProductId, query.recommendationProductId));
    if (query.placement) conditions.push(eq(recommendationEvents.placement, query.placement));
    if (query.anonymousId) conditions.push(eq(recommendationEvents.anonymousId, query.anonymousId));
    if (query.customerId) conditions.push(eq(recommendationEvents.customerId, query.customerId));
    if (query.profileId) conditions.push(eq(recommendationEvents.profileId, query.profileId));

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

  async findRecentlyShownProductIds(input: {
    profileId: string;
    withinHours: number;
    limit: number;
  }): Promise<string[]> {
    const rows = await db
      .selectDistinct({ productId: recommendationEvents.recommendationProductId })
      .from(recommendationEvents)
      .where(
        and(
          eq(recommendationEvents.profileId, input.profileId),
          inArray(recommendationEvents.eventType, ["RECOMMENDATION_IMPRESSION", "RECOMMENDATION_CLICKED"]),
          gte(recommendationEvents.createdAt, sql`now() - make_interval(hours => ${input.withinHours})`),
        ),
      )
      .limit(input.limit);
    return rows.map((r) => r.productId).filter((id): id is string => typeof id === "string");
  }

  async findRecentSearchQueries(input: { profileId: string; withinDays: number; limit: number }): Promise<string[]> {
    const rows = await db
      .select({ searchQuery: recommendationEvents.searchQuery, createdAt: recommendationEvents.createdAt })
      .from(recommendationEvents)
      .where(
        and(
          eq(recommendationEvents.profileId, input.profileId),
          eq(recommendationEvents.eventType, "PRODUCT_SEARCHED"),
          gte(recommendationEvents.createdAt, sql`now() - make_interval(days => ${input.withinDays})`),
        ),
      )
      .orderBy(desc(recommendationEvents.createdAt))
      .limit(input.limit * 3);
    const seen = new Set<string>();
    const queries: string[] = [];
    for (const row of rows) {
      const q = row.searchQuery?.trim();
      if (!q || seen.has(q)) continue;
      seen.add(q);
      queries.push(q);
      if (queries.length >= input.limit) break;
    }
    return queries;
  }

  async getTrendingEvents(input: {
    since: Date;
    limit?: number;
  }): Promise<TrendingEventAggregate[]> {
    // R9 fixes: (1) engagement counts ONLY real engagement types — the old
    // catch-all let the engine's own RECOMMENDATION_RESPONSE rows (and any
    // junk type at weight 0.1) push "trending" across its evidence gate;
    // (2) clicks/attributed ATCs write recommendation_product_id with a NULL
    // product_id, so grouping on bare product_id silently dropped exactly the
    // engagement the copy claims — the aggregate groups on the coalesce.
    const productKey = sql<string>`coalesce(${recommendationEvents.recommendationProductId}, ${recommendationEvents.productId})`;
    const rows = await db
      .select({
        productId: productKey,
        eventType: recommendationEvents.eventType,
        count: sql<number>`count(*)::int`,
        lastSeenAt: sql<Date>`max(${recommendationEvents.createdAt})`,
      })
      .from(recommendationEvents)
      .where(
        and(
          gte(recommendationEvents.createdAt, input.since),
          inArray(recommendationEvents.eventType, [
            "PRODUCT_VIEWED",
            "PRODUCT_ADDED_TO_CART",
            "PRODUCT_PURCHASED",
            "RECOMMENDATION_CLICKED",
            "RECOMMENDATION_ADD_TO_CART",
          ]),
        ),
      )
      .groupBy(productKey, recommendationEvents.eventType)
      // R3: LIMIT without ORDER BY made trending truncation arbitrary — which
      // (product, type) groups survived depended on the planner.
      .orderBy(desc(sql`count(*)`), asc(recommendationEvents.productId), asc(recommendationEvents.eventType))
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
