import { sql } from "drizzle-orm";
import { db } from "../client";
import {
  ATTRIBUTION_MODEL,
  type AttributedLine,
  type CommercialTotals,
  type IRecommendationCommercialRepository,
} from "../../../application/ports/IRecommendationCommercialRepository";

export { ATTRIBUTION_MODEL };
export type { AttributedLine, CommercialTotals };

/**
 * The ONE commercial-attribution owner (R3.1 C2, 2026-08-06).
 *
 * A READ-PROJECTION, not a table: every report recomputes from canonical truth
 * (orders, order_items, payment_attempts, recommendation_events), which makes
 * it idempotent, replayable and refund-reversible BY CONSTRUCTION — a reversal
 * cannot be double-applied because nothing is ever applied, only derived.
 * Materialisation waits for a measured need; the CTEs are written so their
 * SELECT could populate a table unchanged.
 *
 * Non-negotiables encoded here:
 * - Join identity is `recommendation_events.profile_id = orders.profile_id` —
 *   both server-issued. No name/phone/time-proximity joins exist anywhere.
 * - Paid truth: payment_status = 'paid' AND status <> 'cancelled' AND no
 *   payment attempt in 'reversed' (full-refund reversal, §18).
 * - Precedence: ATC (7d) > click (7d); impressions (1d) are ASSISTS only and
 *   can never become a primary attribution (§5.3/§5.5).
 * - One primary per order line (DISTINCT ON with deterministic ordering) —
 *   AC16 is structural.
 * - Headlines are PROVEN-only: orders without a profile stamp are
 *   UNATTRIBUTABLE, honestly counted as such, never inferred (§17).
 */

export class DrizzleRecommendationCommercialRepository implements IRecommendationCommercialRepository {
  /**
   * Per-line primary attribution over the window. The DISTINCT ON keeps
   * exactly one strongest-then-latest touch per order item.
   */
  async getAttributedLines(windowDays: number, limit = 200): Promise<AttributedLine[]> {
    const rows = (await db.execute(sql`
      with paid_orders as (
        select o.id, o.order_number, o.profile_id, o.status, o.created_at
        from orders o
        where o.payment_status = 'paid'
          and o.status <> 'cancelled'
          and o.profile_id is not null
          and o.created_at >= now() - make_interval(days => ${windowDays})
          and not exists (
            select 1 from payment_attempts pa
            where pa.order_id = o.id and pa.status = 'reversed'
          )
      ),
      touches as (
        select e.id, e.profile_id, e.recommendation_product_id as product_id, e.event_type,
               e.created_at, e.placement, e.applied_rule_ids, e.utm_campaign,
               case e.event_type
                 when 'RECOMMENDATION_ADD_TO_CART' then 2
                 when 'RECOMMENDATION_CLICKED' then 1
               end as strength
        from recommendation_events e
        where e.profile_id is not null
          and e.recommendation_product_id is not null
          and e.event_type in ('RECOMMENDATION_ADD_TO_CART', 'RECOMMENDATION_CLICKED')
      )
      select * from (
      select distinct on (oi.id)
        o.id as order_id,
        o.order_number,
        oi.id as order_item_id,
        oi.product_id,
        oi.product_name,
        oi.quantity,
        oi.base_subtotal as gross_revenue_ugx,
        oi.discount_amount as discount_allocated_ugx,
        oi.final_line_total as net_revenue_ugx,
        oi.cogs_snapshot_ugx,
        t.event_type as mechanism,
        t.placement,
        t.applied_rule_ids as rule_ids,
        t.utm_campaign,
        t.created_at as touched_at,
        o.status as order_status,
        o.created_at as order_created_at
      from paid_orders o
      join order_items oi on oi.order_id = o.id
      join touches t
        on t.profile_id = o.profile_id
       and t.product_id = oi.product_id
       and t.created_at <= o.created_at
       and t.created_at >= o.created_at - make_interval(days => ${ATTRIBUTION_MODEL.atcWindowDays})
      -- e.id as the final tiebreak: two same-strength touches in one render
      -- batch must pick the SAME winner every time (R3.1 review, minor 4).
      order by oi.id, t.strength desc, t.created_at desc, t.id desc
      ) attributed
      -- Newest orders first — the UI header says "latest" and now means it (M2).
      order by attributed.order_created_at desc
      limit ${limit}
    `)) as unknown as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      orderId: r.order_id as string,
      orderNumber: r.order_number as string,
      orderItemId: r.order_item_id as string,
      productId: r.product_id as string,
      productName: r.product_name as string,
      quantity: Number(r.quantity),
      grossRevenueUgx: Number(r.gross_revenue_ugx),
      discountAllocatedUgx: Number(r.discount_allocated_ugx),
      netRevenueUgx: Number(r.net_revenue_ugx),
      cogsSnapshotUgx: r.cogs_snapshot_ugx === null ? null : Number(r.cogs_snapshot_ugx),
      mechanism: r.mechanism as string,
      placement: (r.placement as string) ?? null,
      ruleIds:
        typeof r.rule_ids === "string"
          ? (JSON.parse(r.rule_ids as string) as string[])
          : ((r.rule_ids as string[]) ?? null),
      utmCampaign: (r.utm_campaign as string) ?? null,
      touchedAt: r.touched_at as Date,
      orderStatus: r.order_status as string,
      orderCreatedAt: r.order_created_at as Date,
    }));
  }

  /** Headline totals with honest partitions (attributed / assisted / organic+unattributable). */
  async getCommercialTotals(windowDays: number): Promise<CommercialTotals> {
    const rows = (await db.execute(sql`
      with paid_orders as (
        select o.id, o.profile_id, o.created_at
        from orders o
        where o.payment_status = 'paid'
          and o.status <> 'cancelled'
          and o.created_at >= now() - make_interval(days => ${windowDays})
          and not exists (select 1 from payment_attempts pa where pa.order_id = o.id and pa.status = 'reversed')
      ),
      touches as (
        select e.id, e.profile_id, e.recommendation_product_id as product_id, e.created_at,
               case e.event_type when 'RECOMMENDATION_ADD_TO_CART' then 2 when 'RECOMMENDATION_CLICKED' then 1 end as strength
        from recommendation_events e
        where e.profile_id is not null
          and e.recommendation_product_id is not null
          and e.event_type in ('RECOMMENDATION_ADD_TO_CART', 'RECOMMENDATION_CLICKED')
      ),
      attributed_lines as (
        select distinct on (oi.id) oi.id, oi.order_id, oi.quantity,
               oi.base_subtotal, oi.final_line_total, oi.cogs_snapshot_ugx
        from paid_orders o
        join order_items oi on oi.order_id = o.id
        join touches t
          on t.profile_id = o.profile_id
         and t.product_id = oi.product_id
         and t.created_at <= o.created_at
         and t.created_at >= o.created_at - make_interval(days => ${ATTRIBUTION_MODEL.atcWindowDays})
        order by oi.id, t.strength desc, t.created_at desc, t.id desc
      ),
      assisted_lines as (
        select distinct oi.id, oi.final_line_total
        from paid_orders o
        join order_items oi on oi.order_id = o.id
        join recommendation_events e
          on e.profile_id = o.profile_id
         and e.recommendation_product_id = oi.product_id
         and e.event_type = 'RECOMMENDATION_IMPRESSION'
         and e.created_at <= o.created_at
         and e.created_at >= o.created_at - make_interval(days => ${ATTRIBUTION_MODEL.viewThroughWindowDays})
        where o.profile_id is not null
          and not exists (select 1 from attributed_lines al where al.id = oi.id)
      )
      select
        (select count(*)::int from paid_orders) as paid_orders,
        (select count(*)::int from paid_orders where profile_id is not null) as with_profile,
        (select count(*)::int from paid_orders where profile_id is null) as unattributable,
        (select count(distinct o2.id)::int from orders o2
          where o2.created_at >= now() - make_interval(days => ${windowDays})
            and (o2.payment_status = 'reversed'
                 or exists (select 1 from payment_attempts pa where pa.order_id = o2.id and pa.status = 'reversed'))) as reversed_excluded,
        (select coalesce(sum(oi.final_line_total), 0)::bigint from paid_orders o join order_items oi on oi.order_id = o.id) as paid_net_total,
        (select count(distinct order_id)::int from attributed_lines) as attributed_orders,
        (select count(*)::int from attributed_lines) as attributed_items,
        (select coalesce(sum(quantity), 0)::int from attributed_lines) as attributed_units,
        (select coalesce(sum(base_subtotal), 0)::bigint from attributed_lines) as direct_gross,
        (select coalesce(sum(final_line_total), 0)::bigint from attributed_lines) as direct_net,
        (select coalesce(sum(final_line_total), 0)::bigint from assisted_lines) as assisted_net,
        (select count(*)::int from attributed_lines where cogs_snapshot_ugx is not null) as lines_with_cogs,
        (select coalesce(sum(cogs_snapshot_ugx), 0)::bigint from attributed_lines where cogs_snapshot_ugx is not null) as cogs_total,
        (select coalesce(sum(final_line_total), 0)::bigint from attributed_lines where cogs_snapshot_ugx is not null) as net_with_cogs
    `)) as unknown as Array<Record<string, unknown>>;

    const r = rows[0] ?? {};
    const directNet = Number(r.direct_net ?? 0);
    const assistedNet = Number(r.assisted_net ?? 0);
    const paidNetTotal = Number(r.paid_net_total ?? 0);
    const linesWithCogs = Number(r.lines_with_cogs ?? 0);

    return {
      windowDays,
      model: ATTRIBUTION_MODEL,
      paidOrders: Number(r.paid_orders ?? 0),
      paidOrdersWithProfile: Number(r.with_profile ?? 0),
      paidOrdersUnattributable: Number(r.unattributable ?? 0),
      reversedOrdersExcluded: Number(r.reversed_excluded ?? 0),
      attributedOrders: Number(r.attributed_orders ?? 0),
      attributedOrderItems: Number(r.attributed_items ?? 0),
      attributedUnits: Number(r.attributed_units ?? 0),
      directAttributedGrossUgx: Number(r.direct_gross ?? 0),
      directAttributedNetUgx: directNet,
      assistedNetUgx: assistedNet,
      // A true partition (R3.1 review, minor 2): direct + assisted +
      // organic/unattributable = paid net total, with no overlap.
      organicPaidNetUgx: Math.max(0, paidNetTotal - directNet - assistedNet),
      attributedLinesWithCogs: linesWithCogs,
      attributedCogsUgx: Number(r.cogs_total ?? 0),
      attributedGrossMarginUgx:
        linesWithCogs > 0 ? Number(r.net_with_cogs ?? 0) - Number(r.cogs_total ?? 0) : null,
    };
  }

  /** The full commercial funnel with canonical statuses (§6/§9). */
  async getCommercialFunnel(windowDays: number): Promise<{
    windowDays: number;
    impressions: number;
    clicks: number;
    addToCarts: number;
    profilesWithTouch: number;
    paidOrdersFromTouchedProfiles: number;
    fulfilledOrdersFromTouchedProfiles: number;
    completedOrdersFromTouchedProfiles: number;
  }> {
    const rows = (await db.execute(sql`
      with touched as (
        select e.profile_id, min(e.created_at) as first_touch_at
        from recommendation_events e
        where e.profile_id is not null
          and e.event_type in ('RECOMMENDATION_IMPRESSION', 'RECOMMENDATION_CLICKED', 'RECOMMENDATION_ADD_TO_CART')
          and e.created_at >= now() - make_interval(days => ${windowDays})
        group by e.profile_id
      ),
      counts as (
        select
          count(*) filter (where event_type = 'RECOMMENDATION_IMPRESSION')::int as impressions,
          count(*) filter (where event_type = 'RECOMMENDATION_CLICKED')::int as clicks,
          count(*) filter (where event_type = 'RECOMMENDATION_ADD_TO_CART')::int as atcs
        from recommendation_events
        where created_at >= now() - make_interval(days => ${windowDays})
      ),
      orders_by_stage as (
        select
          count(distinct o.id) filter (where o.payment_status = 'paid' and o.status <> 'cancelled')::int as paid,
          count(distinct o.id) filter (where o.payment_status = 'paid' and o.status in ('dispatched', 'completed'))::int as fulfilled,
          count(distinct o.id) filter (where o.payment_status = 'paid' and o.status = 'completed')::int as completed
        from orders o
        join touched t on t.profile_id = o.profile_id
        where o.created_at >= now() - make_interval(days => ${windowDays})
          -- An order placed BEFORE the profile's first recommendation touch
          -- cannot be a funnel outcome of it (R3.1 review, minor 5).
          and o.created_at >= t.first_touch_at
          and not exists (select 1 from payment_attempts pa where pa.order_id = o.id and pa.status = 'reversed')
      )
      select c.impressions, c.clicks, c.atcs,
             (select count(*)::int from touched) as touched_profiles,
             s.paid, s.fulfilled, s.completed
      from counts c, orders_by_stage s
    `)) as unknown as Array<Record<string, number>>;

    const r = rows[0] ?? {};
    return {
      windowDays,
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      addToCarts: Number(r.atcs ?? 0),
      profilesWithTouch: Number(r.touched_profiles ?? 0),
      paidOrdersFromTouchedProfiles: Number(r.paid ?? 0),
      fulfilledOrdersFromTouchedProfiles: Number(r.fulfilled ?? 0),
      completedOrdersFromTouchedProfiles: Number(r.completed ?? 0),
    };
  }

  /**
   * Realised customer value cohorts (§10.1). Keyed on canonical user_id —
   * merge-safe because the profile→customer link resolves BEFORE counting,
   * and one customer with many profiles is one cohort member (AC10).
   */
  async getCustomerValueCohorts(): Promise<{
    cohorts: Array<{
      cohort: "recommendation_acquired" | "recommendation_assisted" | "not_exposed";
      customers: number;
      netRevenue30dUgx: number;
      netRevenue60dUgx: number;
      netRevenue90dUgx: number;
      repeatPurchasers: number;
    }>;
  }> {
    const rows = (await db.execute(sql`
      with paying_customers as (
        select o.user_id,
               min(o.created_at) as first_paid_at
        from orders o
        where o.payment_status = 'paid' and o.status <> 'cancelled' and o.user_id is not null
          and not exists (select 1 from payment_attempts pa where pa.order_id = o.id and pa.status = 'reversed')
        group by o.user_id
      ),
      exposure as (
        select distinct ep.customer_id
        from recommendation_events e
        join experience_profiles ep on ep.id = e.profile_id
        where ep.customer_id is not null
          and e.event_type in ('RECOMMENDATION_IMPRESSION', 'RECOMMENDATION_CLICKED', 'RECOMMENDATION_ADD_TO_CART')
      ),
      first_order_attributed as (
        select distinct o.user_id
        from orders o
        join paying_customers pc on pc.user_id = o.user_id and pc.first_paid_at = o.created_at
        join recommendation_events e
          on e.profile_id = o.profile_id
         and e.event_type in ('RECOMMENDATION_ADD_TO_CART', 'RECOMMENDATION_CLICKED')
         and e.created_at <= o.created_at
         and e.created_at >= o.created_at - make_interval(days => ${ATTRIBUTION_MODEL.atcWindowDays})
        where o.profile_id is not null
      ),
      classified as (
        select pc.user_id, pc.first_paid_at,
          case
            when foa.user_id is not null then 'recommendation_acquired'
            when ex.customer_id is not null then 'recommendation_assisted'
            else 'not_exposed'
          end as cohort
        from paying_customers pc
        left join first_order_attributed foa on foa.user_id = pc.user_id
        left join exposure ex on ex.customer_id = pc.user_id
      ),
      value_windows as (
        select c.cohort, c.user_id,
          coalesce(sum(oi.final_line_total) filter (where o.created_at < c.first_paid_at + interval '30 days'), 0) as net_30,
          coalesce(sum(oi.final_line_total) filter (where o.created_at < c.first_paid_at + interval '60 days'), 0) as net_60,
          coalesce(sum(oi.final_line_total) filter (where o.created_at < c.first_paid_at + interval '90 days'), 0) as net_90,
          count(distinct o.id) as paid_orders
        from classified c
        join orders o on o.user_id = c.user_id
          and o.payment_status = 'paid' and o.status <> 'cancelled'
          and not exists (select 1 from payment_attempts pa where pa.order_id = o.id and pa.status = 'reversed')
        join order_items oi on oi.order_id = o.id
        group by c.cohort, c.user_id
      )
      select cohort,
             count(*)::int as customers,
             coalesce(sum(net_30), 0)::bigint as net_30,
             coalesce(sum(net_60), 0)::bigint as net_60,
             coalesce(sum(net_90), 0)::bigint as net_90,
             count(*) filter (where paid_orders >= 2)::int as repeat_purchasers
      from value_windows
      group by cohort
    `)) as unknown as Array<Record<string, unknown>>;

    return {
      cohorts: rows.map((r) => ({
        cohort: r.cohort as "recommendation_acquired" | "recommendation_assisted" | "not_exposed",
        customers: Number(r.customers),
        netRevenue30dUgx: Number(r.net_30),
        netRevenue60dUgx: Number(r.net_60),
        netRevenue90dUgx: Number(r.net_90),
        repeatPurchasers: Number(r.repeat_purchasers),
      })),
    };
  }

  /** Media spend joined by campaign lineage (§12). Empty spend = no ROAS, ever. */
  async getMediaSpend(windowDays: number): Promise<{
    totalSpendMinor: number;
    mixedCurrencies: string[];
    campaigns: Array<{ campaign: string; spendMinor: number; currency: string }>;
    sources: number;
  }> {
    const rows = (await db.execute(sql`
      select campaign, currency,
             coalesce(sum(spend_minor + tax_or_fee_minor), 0)::bigint as spend,
             count(distinct source)::int as sources
      from media_cost_facts
      -- Spend dates are CALENDAR days in Kampala; the window edge must not
      -- drift a day on the UTC boundary (R3.1 review, minor 7).
      where spend_date >= ((now() at time zone 'Africa/Kampala') - make_interval(days => ${windowDays}))::date
      group by campaign, currency
      order by spend desc
      limit 100
    `)) as unknown as Array<Record<string, unknown>>;

    const currencies = [...new Set(rows.map((r) => r.currency as string))];
    return {
      // M1 (R3.1 review): a cross-currency sum is not a number — UGX-only
      // totals are summed; anything else forces the caller to refuse ROAS.
      totalSpendMinor: currencies.every((c) => c === "UGX")
        ? rows.reduce((s, r) => s + Number(r.spend), 0)
        : rows.filter((r) => r.currency === "UGX").reduce((s, r) => s + Number(r.spend), 0),
      mixedCurrencies: currencies.filter((c) => c !== "UGX"),
      campaigns: rows.map((r) => ({
        campaign: r.campaign as string,
        spendMinor: Number(r.spend),
        currency: r.currency as string,
      })),
      sources: rows.reduce((s, r) => Math.max(s, Number(r.sources)), 0),
    };
  }

  async insertMediaCostFact(input: {
    spendDate: string;
    channel: string;
    platform: string;
    account: string;
    campaign: string;
    adSetOrGroup?: string | null;
    adOrCreative?: string | null;
    currency: string;
    spendMinor: number;
    taxOrFeeMinor: number;
    source: string;
    sourceReference?: string | null;
    ingestedBy: string;
  }): Promise<{ inserted: boolean }> {
    const rows = (await db.execute(sql`
      insert into media_cost_facts
        (spend_date, channel, platform, account, campaign, ad_set_or_group, ad_or_creative,
         currency, spend_minor, tax_or_fee_minor, source, source_reference, ingested_by)
      values
        (${input.spendDate}::date, ${input.channel}, ${input.platform}, ${input.account},
         ${input.campaign}, ${input.adSetOrGroup ?? null}, ${input.adOrCreative ?? null},
         ${input.currency}, ${input.spendMinor}, ${input.taxOrFeeMinor}, ${input.source},
         ${input.sourceReference ?? null}, ${input.ingestedBy}::uuid)
      on conflict do nothing
      returning id
    `)) as unknown as Array<{ id: string }>;
    return { inserted: rows.length > 0 };
  }

  /** Commercial data-quality checks (§19) — counted, never silently absorbed. */
  async getCommercialDataQuality(windowDays: number): Promise<{
    windowDays: number;
    paidOrdersWithoutProfile: number;
    paidOrdersWithoutLines: number;
    atcWithoutPriorClickOrImpression: number;
    linesMissingCogsSnapshot: number;
    mediaSpendRows: number;
  }> {
    const rows = (await db.execute(sql`
      select
        (select count(*)::int from orders o
          where o.payment_status = 'paid' and o.status <> 'cancelled' and o.profile_id is null
            and o.created_at >= now() - make_interval(days => ${windowDays})) as no_profile,
        (select count(*)::int from orders o
          where o.payment_status = 'paid'
            and o.created_at >= now() - make_interval(days => ${windowDays})
            and not exists (select 1 from order_items oi where oi.order_id = o.id)) as no_lines,
        (select count(*)::int from recommendation_events atc
          where atc.event_type = 'RECOMMENDATION_ADD_TO_CART'
            and atc.profile_id is not null
            and atc.created_at >= now() - make_interval(days => ${windowDays})
            and not exists (
              select 1 from recommendation_events prior
              where prior.profile_id = atc.profile_id
                and prior.recommendation_product_id = atc.recommendation_product_id
                and prior.event_type in ('RECOMMENDATION_IMPRESSION', 'RECOMMENDATION_CLICKED')
                and prior.created_at <= atc.created_at
            )) as atc_no_exposure,
        (select count(*)::int from order_items oi
          join orders o on o.id = oi.order_id
          where o.payment_status = 'paid'
            and o.created_at >= now() - make_interval(days => ${windowDays})
            and oi.cogs_snapshot_ugx is null) as lines_no_cogs,
        (select count(*)::int from media_cost_facts) as spend_rows
    `)) as unknown as Array<Record<string, number>>;

    const r = rows[0] ?? {};
    return {
      windowDays,
      paidOrdersWithoutProfile: Number(r.no_profile ?? 0),
      paidOrdersWithoutLines: Number(r.no_lines ?? 0),
      atcWithoutPriorClickOrImpression: Number(r.atc_no_exposure ?? 0),
      linesMissingCogsSnapshot: Number(r.lines_no_cogs ?? 0),
      mediaSpendRows: Number(r.spend_rows ?? 0),
    };
  }
}
