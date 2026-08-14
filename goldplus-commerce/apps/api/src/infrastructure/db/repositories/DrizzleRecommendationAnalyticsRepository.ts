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

/** postgres-js returns an array; some drivers wrap it in `.rows`. */
const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : (r as any)?.rows ?? []);

export class DrizzleRecommendationAnalyticsRepository implements IRecommendationAnalyticsRepository {
  /**
   * Serving truth (R6, 2026-08-06) — computed from the engine's own
   * RECOMMENDATION_RESPONSE events, not from browser beacons. "Is the engine
   * serving, are placements filled, and how deep into the fallback ladder are
   * we living?" are answerable even with zero client JavaScript.
   */
  /**
   * The commercial attribution chain, joined through the cart.
   *
   *   recommendation_events.cart_id -> orders.cart_id -> order_items
   *
   * A line only counts as revenue when the order was genuinely paid and not
   * cancelled; both facts travel with the row so the calculator can exclude
   * them explicitly rather than the query silently dropping them. COGS comes
   * from order_items.cogs_snapshot_ugx — the cost captured at the time of sale,
   * not today's cost — and stays null when it was never captured.
   */
  async getCommercialAttribution(startDate: Date, endDate: Date): Promise<any> {
    const start = startDate.toISOString();
    const end = endDate.toISOString();

    const lines = rowsOf(await db.execute(sql`
      select distinct
        o.id::text            as order_id,
        oi.product_id::text   as product_id,
        oi.final_line_total   as line_total,
        oi.cogs_snapshot_ugx  as cogs,
        (o.payment_status = 'paid')                         as paid,
        (o.status in ('cancelled', 'CANCELLED'))            as cancelled,
        o.customer_id::text   as customer_id,
        coalesce(o.pricing_currency, 'UGX')                 as currency
      from recommendation_events e
      join orders o       on o.cart_id = e.cart_id
      join order_items oi on oi.order_id = o.id
                         and oi.product_id = e.recommendation_product_id
      where e.cart_id is not null
        and e.recommendation_product_id is not null
        and e.created_at >= ${start}::timestamptz
        and e.created_at <= ${end}::timestamptz
    `));

    const attributedLines = lines.map((r: any) => ({
      orderId: String(r.order_id),
      productId: String(r.product_id),
      lineTotalUgx: Number(r.line_total ?? 0),
      // Null, never 0: an unrecorded cost must not read as free goods.
      cogsUgx: r.cogs === null || r.cogs === undefined ? null : Number(r.cogs),
      paid: Boolean(r.paid),
      cancelled: Boolean(r.cancelled),
      refundedUgx: 0,
      customerId: r.customer_id ? String(r.customer_id) : null,
      currency: String(r.currency ?? 'UGX'),
    }));

    const attributedCompletedOrders = new Set(
      attributedLines.filter((l) => l.paid && !l.cancelled).map((l) => l.orderId),
    ).size;

    // Media spend: null when NO record exists at all, which is a different
    // fact from a recorded spend of zero and must not become a ROAS of 0.
    const spendRows = rowsOf(await db.execute(sql`
      select coalesce(sum(spend_minor + coalesce(tax_or_fee_minor, 0)), 0) as spend_minor,
             count(*)::int as rows
      from media_cost_facts
      where spend_date >= ${start}::date and spend_date <= ${end}::date
    `));
    const spendRowCount = Number(spendRows[0]?.rows ?? 0);
    const mediaSpendUgx = spendRowCount === 0 ? null : Number(spendRows[0]?.spend_minor ?? 0) / 100;

    // Realised value per identified customer, across all history.
    const customerRows = rowsOf(await db.execute(sql`
      select customer_id::text as customer_id,
             count(*)::int      as completed_orders,
             coalesce(sum(total_amount), 0) as total_paid
      from orders
      where customer_id is not null
        and payment_status = 'paid'
        and status not in ('cancelled', 'CANCELLED')
      group by customer_id
    `));

    return {
      attributedLines,
      attributedCompletedOrders,
      mediaSpendUgx,
      customerOrderTotals: customerRows.map((r: any) => ({
        customerId: String(r.customer_id),
        completedOrders: Number(r.completed_orders ?? 0),
        totalPaidUgx: Number(r.total_paid ?? 0),
      })),
    };
  }

  async getServingHealth(sinceDays: number): Promise<{
    windowDays: number;
    placements: Array<{
      placement: string;
      responses: number;
      empty: number;
      fallbackServed: number;
      lastResponseAt: Date | null;
    }>;
    totalResponses: number;
  }> {
    // The metadata column carries double-encoded rows (the drizzle +
    // postgres.js jsonb double-stringify, same as the materialized cache) —
    // normalise a string-typed jsonb back to its object before reading keys,
    // or fill/fallback would read zero forever against real data.
    const rows = (await db.execute(sql`
      with responses as (
        select
          placement,
          created_at,
          case when jsonb_typeof(metadata) = 'string' then (metadata #>> '{}')::jsonb else metadata end as meta
        from recommendation_events
        where event_type = 'RECOMMENDATION_RESPONSE'
          and created_at >= now() - make_interval(days => ${sinceDays})
          and placement is not null
      )
      select
        placement,
        count(*)::int as responses,
        count(*) filter (where meta ? 'emptyReason')::int as empty,
        count(*) filter (where coalesce((meta->>'fallbackLevel')::int, 0) > 0)::int as fallback_served,
        max(created_at) as last_response_at
      from responses
      group by placement
      order by placement
    `)) as unknown as Array<{
      placement: string;
      responses: number;
      empty: number;
      fallback_served: number;
      last_response_at: Date | null;
    }>;

    const placements = rows.map((r) => ({
      placement: r.placement,
      responses: Number(r.responses),
      empty: Number(r.empty),
      fallbackServed: Number(r.fallback_served),
      lastResponseAt: r.last_response_at,
    }));
    return {
      windowDays: sinceDays,
      placements,
      totalResponses: placements.reduce((sum, p) => sum + p.responses, 0),
    };
  }

  /**
   * Event lineage and data-quality classification (R4, 2026-08-06; §21).
   * Historic rows are NEVER reclassified or backfilled — schema_version NULL
   * simply means "written before the contract existed", and stays that way.
   * An orphan click is a click whose attribution chain has no impression:
   * either a lost impression write or a fabricated beacon — both are facts an
   * operator should see counted, not silently absorbed into CTR.
   */
  async getLineageReport(sinceDays: number): Promise<{
    windowDays: number;
    total: number;
    historicPreContract: number;
    contractV2: number;
    identityUnavailable: number;
    railEventsMissingPlacement: number;
    orphanClicks: number;
    attributedAtcWithoutExposure: number;
    profileStamped: number;
    totalClicks: number;
    clientContractV2: number;
    clientProfileStamped: number;
  }> {
    const rows = await db.execute(sql`
      with windowed as (
        select * from recommendation_events
        where created_at >= now() - make_interval(days => ${sinceDays})
      )
      select
        count(*)::int as total,
        count(*) filter (where schema_version is null)::int as historic_pre_contract,
        count(*) filter (where schema_version = 2)::int as contract_v2,
        count(*) filter (where anonymous_id is null and customer_id is null and profile_id is null)::int as identity_unavailable,
        count(*) filter (
          where event_type in ('RECOMMENDATION_IMPRESSION','RECOMMENDATION_CLICKED','RECOMMENDATION_ADD_TO_CART')
          and placement is null
        )::int as rail_events_missing_placement,
        count(*) filter (
          where event_type = 'RECOMMENDATION_CLICKED'
          and attribution_id is not null
          and not exists (
            select 1 from recommendation_events i
            where i.event_type = 'RECOMMENDATION_IMPRESSION'
              and i.attribution_id = windowed.attribution_id
          )
        )::int as orphan_clicks,
        count(*) filter (
          where event_type = 'RECOMMENDATION_ADD_TO_CART'
          and (
            attribution_id is null
            or not exists (
              select 1 from recommendation_events e
              where e.attribution_id = windowed.attribution_id
                and e.event_type in ('RECOMMENDATION_IMPRESSION','RECOMMENDATION_CLICKED')
                and e.id <> windowed.id
            )
          )
        )::int as attributed_atc_without_exposure,
        count(*) filter (where profile_id is not null)::int as profile_stamped,
        count(*) filter (where event_type = 'RECOMMENDATION_CLICKED')::int as total_clicks,
        count(*) filter (where schema_version = 2 and coalesce(producer,'') in ('web-relay','public-api'))::int as client_contract_v2,
        count(*) filter (where profile_id is not null and coalesce(producer,'') in ('web-relay','public-api'))::int as client_profile_stamped
      from windowed
    `);
    const row = (rows as unknown as Array<Record<string, number>>)[0] ?? {};
    return {
      windowDays: sinceDays,
      total: Number(row.total ?? 0),
      historicPreContract: Number(row.historic_pre_contract ?? 0),
      contractV2: Number(row.contract_v2 ?? 0),
      identityUnavailable: Number(row.identity_unavailable ?? 0),
      railEventsMissingPlacement: Number(row.rail_events_missing_placement ?? 0),
      orphanClicks: Number(row.orphan_clicks ?? 0),
      attributedAtcWithoutExposure: Number(row.attributed_atc_without_exposure ?? 0),
      profileStamped: Number(row.profile_stamped ?? 0),
      totalClicks: Number(row.total_clicks ?? 0),
      clientContractV2: Number(row.client_contract_v2 ?? 0),
      clientProfileStamped: Number(row.client_profile_stamped ?? 0),
    };
  }

  async getSummaryMetrics(query: Omit<RecommendationAnalyticsQuery, "startDate" | "endDate"> & { startDate: Date; endDate: Date }): Promise<AnalyticsSummary> {
    const filters = this.buildFilters(query);

    const rows = await db
      .select({
        totalEvents: count(),
        impressions: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_IMPRESSION' then 1 end)::int`,
        clicks: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_CLICKED' then 1 end)::int`,
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
        clicks: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_CLICKED' then 1 end)::int`,
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
        clicks: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_CLICKED' then 1 end)::int`,
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
        clicks: sql<number>`count(case when ${recommendationEvents.eventType} = 'RECOMMENDATION_CLICKED' then 1 end)::int`,
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
        // Scoped to client producers: api-engine rows carry no anonymous id BY
        // DESIGN, and counting them made this warning a permanent false alarm.
        missingAnonymousId: sql<number>`count(case when ${recommendationEvents.anonymousId} is null and coalesce(${recommendationEvents.producer}, '') <> 'api-engine' then 1 end)::int`,
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
    if (query.eventType) {
      conditions.push(eq(recommendationEvents.eventType, query.eventType));
    } else {
      // R9 (M4): the engine's own server-native rows (RECOMMENDATION_RESPONSE /
      // RECOMMENDATION_ERROR) are serving telemetry, not customer behaviour —
      // without this exclusion they inflated totalEvents, "organic" counts and
      // every share computed against them. An explicit eventType filter may
      // still ask for them by name.
      conditions.push(
        sql`${recommendationEvents.eventType} not in ('RECOMMENDATION_RESPONSE', 'RECOMMENDATION_ERROR')`,
      );
    }

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

  async depthMetricsRaw(windowDays: number) {
    const { sql } = await import('drizzle-orm');
    const { recommendationEvents } = await import('../schema/recommendations');
    const { products } = await import('../schema/products');
    const { isRecommendationPlacement } = await import('../../../application/recommendations/RecommendationValidation');
    const since = new Date(Date.now() - windowDays * 24 * 3600_000);

    const [totals] = await db
      .select({
        totalEvents: sql<number>`count(*)::int`,
        distinctRecommendedProducts: sql<number>`count(distinct recommendation_product_id) filter (where recommendation_product_id is not null)::int`,
        // R9 (m10): only RAIL event types owe a placement — counting
        // PRODUCT_VIEWED page events as "unknown placement" manufactured a
        // permanent defect signal.
        nullPlacementEvents: sql<number>`count(*) filter (where placement is null and event_type in ('RECOMMENDATION_IMPRESSION','RECOMMENDATION_CLICKED','RECOMMENDATION_ADD_TO_CART','RECOMMENDATION_VIEWED'))::int`,
      })
      .from(recommendationEvents)
      .where(sql`${recommendationEvents.createdAt} >= ${since}`);

    const placements = await db
      .select({ placement: recommendationEvents.placement, events: sql<number>`count(*)::int` })
      .from(recommendationEvents)
      .where(sql`${recommendationEvents.createdAt} >= ${since} and ${recommendationEvents.placement} is not null`)
      .groupBy(recommendationEvents.placement);
    const invalidPlacementEvents = placements
      .filter((p) => !isRecommendationPlacement(p.placement))
      .reduce((sum, p) => sum + p.events, 0);

    // R9 (m10): the coverage denominator is the SELLABLE catalogue — counting
    // drafts and inactive rows made coverage read systematically low.
    const [{ activeProducts }] = await db
      .select({ activeProducts: sql<number>`count(*) filter (where ${products.active} = true and ${products.approvalStatus} = 'approved')::int` })
      .from(products);

    const topProducts = await db
      .select({ productId: recommendationEvents.recommendationProductId, events: sql<number>`count(*)::int` })
      .from(recommendationEvents)
      .where(sql`${recommendationEvents.createdAt} >= ${since} and ${recommendationEvents.recommendationProductId} is not null`)
      .groupBy(recommendationEvents.recommendationProductId)
      .orderBy(sql`count(*) desc`)
      .limit(5);

    const sourceBreakdown = await db
      .select({ source: sql<string>`coalesce(${recommendationEvents.source}, 'unknown')`, events: sql<number>`count(*)::int` })
      .from(recommendationEvents)
      .where(sql`${recommendationEvents.createdAt} >= ${since}`)
      .groupBy(sql`coalesce(${recommendationEvents.source}, 'unknown')`)
      .orderBy(sql`count(*) desc`);

    return {
      totalEvents: totals?.totalEvents ?? 0,
      distinctRecommendedProducts: totals?.distinctRecommendedProducts ?? 0,
      activeProducts: activeProducts ?? 0,
      nullPlacementEvents: totals?.nullPlacementEvents ?? 0,
      invalidPlacementEvents,
      topProducts: topProducts.map((t) => ({ productId: t.productId as string, events: t.events })),
      sourceBreakdown,
    };
  }

}
