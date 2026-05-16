import { and, eq, gte, lte, sql, desc, count, isNull, isNotNull, inArray } from "drizzle-orm";
import type { 
  RecommendationAnalyticsQuery 
} from "@goldplus/shared";
import type { 
  IRecommendationAnalyticsRepository,
  AnalyticsSummary,
  PlacementPerformanceRecord,
  RulePerformanceRecord,
  ProductPerformanceRecord,
  EventHealthMetrics,
  IdentityHealthMetrics
} from "../../../application/ports/IRecommendationAnalyticsRepository";
import { recommendationEvents, recommendationRules } from "../schema/recommendations";
import { identityLinks } from "../schema/identity";
import { products } from "../schema/products";
import { db } from "../client";

export class DrizzleRecommendationAnalyticsRepository implements IRecommendationAnalyticsRepository {
  async getSummaryMetrics(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<AnalyticsSummary> {
    const filters = this.buildFilters(query);

    const rows = await db
      .select({
        totalEvents: count(),
        impressions: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_IMPRESSION' then 1 end)::int`,
        clicks: sql<number>`count(case when ${recommendationEvents.eventType} in ('RECOMMENDATION_CLICKED', 'RECOMMENDATION_CLICK') then 1 end)::int`,
        addToCart: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_ADD_TO_CART' then 1 end)::int`,
        attributedEvents: sql<number>`count(case when ${recommendationEvents.attributionId} is not null then 1 end)::int`,
        unattributedEvents: sql<number>`count(case when ${recommendationEvents.attributionId} is null then 1 end)::int`,
        ruleAssistedEvents: sql<number>`count(case when ${recommendationEvents.ruleId} is not null then 1 end)::int`,
        organicEvents: sql<number>`count(case when ${recommendationEvents.ruleId} is null then 1 end)::int`,
        uniqueAnonymousVisitors: sql<number>`count(distinct ${recommendationEvents.anonymousId})::int`,
        uniqueBrowserVisitors: sql<number>`count(distinct ${recommendationEvents.browserId})::int`,
        uniqueCarts: sql<number>`count(distinct ${recommendationEvents.cartId})::int`,
      })
      .from(recommendationEvents)
      .where(filters);

    return rows[0] || this.emptySummary();
  }

  async getPlacementPerformance(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<PlacementPerformanceRecord[]> {
    const filters = this.buildFilters(query);

    const rows = await db
      .select({
        placement: recommendationEvents.placement,
        impressions: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_IMPRESSION' then 1 end)::int`,
        clicks: sql<number>`count(case when ${recommendationEvents.eventType} in ('RECOMMENDATION_CLICKED', 'RECOMMENDATION_CLICK') then 1 end)::int`,
        addToCart: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_ADD_TO_CART' then 1 end)::int`,
        attributedEvents: sql<number>`count(case when ${recommendationEvents.attributionId} is not null then 1 end)::int`,
        organicEvents: sql<number>`count(case when ${recommendationEvents.ruleId} is null then 1 end)::int`,
        ruleAssistedEvents: sql<number>`count(case when ${recommendationEvents.ruleId} is not null then 1 end)::int`,
      })
      .from(recommendationEvents)
      .where(filters)
      .groupBy(recommendationEvents.placement);

    return rows.map(r => ({ ...r, placement: r.placement || "unknown" }));
  }

  async getRulePerformance(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<RulePerformanceRecord[]> {
    const filters = this.buildFilters(query);

    const rows = await db
      .select({
        ruleId: recommendationEvents.ruleId,
        ruleName: recommendationRules.name,
        impressions: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_IMPRESSION' then 1 end)::int`,
        clicks: sql<number>`count(case when ${recommendationEvents.eventType} in ('RECOMMENDATION_CLICKED', 'RECOMMENDATION_CLICK') then 1 end)::int`,
        addToCart: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_ADD_TO_CART' then 1 end)::int`,
        placementsTouched: sql<string[]>`array_agg(distinct ${recommendationEvents.placement})`,
        productsTouched: sql<number>`count(distinct ${recommendationEvents.recommendationProductId})::int`,
        reasonCodes: sql<string[]>`array_agg(distinct ${recommendationEvents.reasonCode})`,
      })
      .from(recommendationEvents)
      .leftJoin(recommendationRules, eq(recommendationEvents.ruleId, recommendationRules.id))
      .where(filters)
      .groupBy(recommendationEvents.ruleId, recommendationRules.name);

    return rows.map(r => ({
      ...r,
      placementsTouched: (r.placementsTouched || []).filter(Boolean),
      reasonCodes: (r.reasonCodes || []).filter(Boolean)
    }));
  }

  async getProductPerformance(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<ProductPerformanceRecord[]> {
    const filters = this.buildFilters(query);

    const rows = await db
      .select({
        productId: sql<string>`coalesce(${recommendationEvents.recommendationProductId}, ${recommendationEvents.productId})`,
        productName: products.name,
        sku: products.sku,
        impressions: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_IMPRESSION' then 1 end)::int`,
        clicks: sql<number>`count(case when ${recommendationEvents.eventType} in ('RECOMMENDATION_CLICKED', 'RECOMMENDATION_CLICK') then 1 end)::int`,
        addToCart: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_ADD_TO_CART' then 1 end)::int`,
        placements: sql<string[]>`array_agg(distinct ${recommendationEvents.placement})`,
        ruleAssistedCount: sql<number>`count(case when ${recommendationEvents.ruleId} is not null then 1 end)::int`,
        organicCount: sql<number>`count(case when ${recommendationEvents.ruleId} is null then 1 end)::int`,
      })
      .from(recommendationEvents)
      .leftJoin(products, eq(sql`coalesce(${recommendationEvents.recommendationProductId}, ${recommendationEvents.productId})`, products.id))
      .where(filters)
      .groupBy(sql`coalesce(${recommendationEvents.recommendationProductId}, ${recommendationEvents.productId})`, products.name, products.sku)
      .orderBy(desc(sql`count(*)`))
      .limit(50);

    return rows.map(r => ({
      ...r,
      productId: r.productId as string,
      placements: (r.placements || []).filter(Boolean)
    }));
  }

  async getEventHealth(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<EventHealthMetrics> {
    const filters = this.buildFilters(query);

    const rows = await db
      .select({
        totalEvents: count(),
        missingAttributionId: sql<number>`count(case when ${recommendationEvents.attributionId} is null then 1 end)::int`,
        missingPlacement: sql<number>`count(case when ${recommendationEvents.placement} is null then 1 end)::int`,
        missingProductId: sql<number>`count(case when ${recommendationEvents.productId} is null and ${recommendationEvents.recommendationProductId} is null then 1 end)::int`,
        missingAnonymousId: sql<number>`count(case when ${recommendationEvents.anonymousId} is null then 1 end)::int`,
        latestEventAt: sql<Date>`max(${recommendationEvents.createdAt})`,
      })
      .from(recommendationEvents)
      .where(filters);

    const typeRows = await db
      .select({
        eventType: recommendationEvents.eventType,
        count: count()
      })
      .from(recommendationEvents)
      .where(filters)
      .groupBy(recommendationEvents.eventType);

    const eventsByType: Record<string, number> = {};
    for (const tr of typeRows) {
      eventsByType[tr.eventType] = tr.count;
    }

    return {
      ...(rows[0] || { totalEvents: 0, missingAttributionId: 0, missingPlacement: 0, missingProductId: 0, missingAnonymousId: 0, latestEventAt: null }),
      eventsByType
    };
  }

  async getIdentityHealth(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<IdentityHealthMetrics> {
    const filters = this.buildFilters(query);

    const rows = await db
      .select({
        eventsWithAnonymousId: sql<number>`count(case when ${recommendationEvents.anonymousId} is not null then 1 end)::int`,
        eventsWithBrowserId: sql<number>`count(case when ${recommendationEvents.browserId} is not null then 1 end)::int`,
        eventsWithCartId: sql<number>`count(case when ${recommendationEvents.cartId} is not null then 1 end)::int`,
        eventsWithLeadId: sql<number>`count(case when ${recommendationEvents.leadId} is not null then 1 end)::int`,
        eventsWithCustomerId: sql<number>`count(case when ${recommendationEvents.customerId} is not null then 1 end)::int`,
      })
      .from(recommendationEvents)
      .where(filters);

    const identityRows = await db
      .select({
        count: count(),
        anonToLead: sql<number>`count(case when ${identityLinks.anonymousId} is not null and ${identityLinks.leadId} is not null then 1 end)::int`,
        anonToCustomer: sql<number>`count(case when ${identityLinks.anonymousId} is not null and ${identityLinks.customerId} is not null then 1 end)::int`,
      })
      .from(identityLinks)
      .where(and(gte(identityLinks.createdAt, query.startDate), lte(identityLinks.createdAt, query.endDate)));

    return {
      ...(rows[0] || { eventsWithAnonymousId: 0, eventsWithBrowserId: 0, eventsWithCartId: 0, eventsWithLeadId: 0, eventsWithCustomerId: 0 }),
      identityLinks: identityRows[0]?.count || 0,
      anonymousToLeadLinks: identityRows[0]?.anonToLead || 0,
      anonymousToCustomerLinks: identityRows[0]?.anonToCustomer || 0,
    };
  }

  private buildFilters(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }) {
    const conditions = [
      gte(recommendationEvents.createdAt, query.startDate),
      lte(recommendationEvents.createdAt, query.endDate)
    ];

    if (query.placement) conditions.push(eq(recommendationEvents.placement, query.placement));
    if (query.ruleId) conditions.push(eq(recommendationEvents.ruleId, query.ruleId));
    if (query.productId) {
      conditions.push(and(
        eq(sql`coalesce(${recommendationEvents.recommendationProductId}, ${recommendationEvents.productId})`, query.productId)
      )!);
    }
    if (query.eventType) conditions.push(eq(recommendationEvents.eventType, query.eventType));

    return and(...conditions);
  }

  private emptySummary(): AnalyticsSummary {
    return {
      totalEvents: 0,
      impressions: 0,
      clicks: 0,
      addToCart: 0,
      attributedEvents: 0,
      unattributedEvents: 0,
      organicEvents: 0,
      ruleAssistedEvents: 0,
      uniqueAnonymousVisitors: 0,
      uniqueBrowserVisitors: 0,
      uniqueCarts: 0
    };
  }
}
