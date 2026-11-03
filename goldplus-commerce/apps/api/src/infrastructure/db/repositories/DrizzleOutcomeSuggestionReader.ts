import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { IOutcomeSuggestionReader, OutcomeSuggestionFacts } from '../../../application/ports/IOutcomeSuggestionReader';
import { MICRO_CONVERSIONS } from '../../../domain/measurement/Outcomes';
import { SAME_VISIT_HOURS, type DayPoint } from '../../../domain/measurement/OutcomeGoalSuggestions';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const num = (v: unknown): number => Number(v ?? 0) || 0;
/**
 * The telemetry outbox holds the event as a JSON STRING inside jsonb on production (2026-11-03: every row's
 * payload->>'event_name' read NULL), so the payload is unwrapped before a key is read. Kept in step with the
 * partial index in 0216 (same expression), or the planner cannot use it.
 */
const EV = sql.raw(`(case when jsonb_typeof(o.payload) = 'string' then (o.payload #>> '{}')::jsonb else o.payload end)`);
const KD = (col: string) => sql.raw(`(${col} at time zone 'Africa/Kampala')::date`);

/**
 * Facts for goal suggestions (2026-11-03): 180 Kampala days of carts, checkout starts, orders and GA4 sessions;
 * the average paid order and the gross margin per paid order from the order lines' recorded unit cost; and for
 * each micro conversion, how many events 180–30 days ago were followed by an order (same account, or the same
 * phone by its last nine digits) between one hour and thirty days later. Bounded aggregates only.
 */
export class DrizzleOutcomeSuggestionReader implements IOutcomeSuggestionReader {
  async facts(now = new Date()): Promise<OutcomeSuggestionFacts> {
    const [carts, checkouts, orders, ga4, econ, micro] = await Promise.all([
      db.execute(sql`select ${KD('c.updated_at')} as day, count(*)::int as n from carts c
        where c.updated_at >= ${now}::timestamptz - interval '180 days' and not c.is_probe and exists (select 1 from cart_items i where i.cart_id = c.id) group by 1`),
      db.execute(sql`select ${KD('o.created_at')} as day, count(distinct coalesce(${EV}->'user_data'->>'fp_client_id', o.id::text))::int as n from outbox_events o
        where o.event_type = 'TELEMETRY_DISPATCH' and ${EV}->>'event_name' = 'begin_checkout' and o.created_at >= ${now}::timestamptz - interval '180 days' group by 1`),
      db.execute(sql`select ${KD('o.created_at')} as day, count(*)::int as n from orders o where o.created_at >= ${now}::timestamptz - interval '180 days' group by 1`),
      db.execute(sql`select day::text as day, sum(sessions)::int as n from measurement.ga4_daily_series where report = 'source_medium' and day >= (${now}::timestamptz at time zone 'Africa/Kampala')::date - 180 group by 1`),
      db.execute(sql`
        with paid as (select o.id, o.total_amount from orders o where o.payment_status = 'paid' and o.created_at >= ${now}::timestamptz - interval '90 days'),
        lines as (select i.order_id, i.quantity, i.unit_price, i.cogs_snapshot_ugx as unit_cost from order_items i join paid on paid.id = i.order_id)
        select (select count(*) from paid) as paid_orders, (select coalesce(avg(total_amount), 0) from paid) as aov,
               (select coalesce(sum(quantity * (unit_price - unit_cost)), 0) / greatest(1, count(distinct order_id)) from lines where unit_cost is not null) as margin,
               (select case when count(*) = 0 then 0 else count(*) filter (where unit_cost is not null)::numeric / count(*) end from lines) as coverage`),
      db.execute(sql`
        with p as (select ${now}::timestamptz - interval '180 days' as s180, ${now}::timestamptz - interval '30 days' as s30),
        ophone as (select right(regexp_replace(customer_phone, '\\D', '', 'g'), 9) as ph, created_at, user_id from orders),
        ev as (
          select 'sign_up' as k, u.created_at as at, right(regexp_replace(coalesce(u.phone, ''), '\\D', '', 'g'), 9) as ph, u.id as uid from users u
          union all select 'product_question', q.created_at, right(regexp_replace(coalesce(q.asker_phone, ''), '\\D', '', 'g'), 9), null::uuid from product_questions q
          union all select 'battery_request', b.created_at, right(regexp_replace(coalesce(b.contact_phone, ''), '\\D', '', 'g'), 9), null::uuid from battery_requests b
          union all select 'quote_request', q.created_at, right(regexp_replace(coalesce(q.phone, ''), '\\D', '', 'g'), 9), null::uuid from quote_requests q
          union all select 'dealer_application', d.created_at, right(regexp_replace(coalesce(d.phone, ''), '\\D', '', 'g'), 9), null::uuid from dealer_applications d
          union all select 'gift_card_purchase', g.paid_at, right(regexp_replace(coalesce(g.buyer_phone, ''), '\\D', '', 'g'), 9), g.buyer_user_id from gift_card_purchases g where g.paid_at is not null
          union all select 'wishlist_add', w.added_at, null::text, w.user_id from wishlists w
        )
        select e.k, count(*)::int as n,
          count(*) filter (where exists (select 1 from ophone o where o.created_at > e.at + (${SAME_VISIT_HOURS} || ' hours')::interval and o.created_at <= e.at + interval '30 days'
            and ((e.uid is not null and o.user_id = e.uid) or (length(e.ph) = 9 and o.ph = e.ph))))::int as converted
        from ev e, p where e.at >= p.s180 and e.at < p.s30 group by e.k`),
    ]);
    const byDay = (r: unknown) => new Map(rows(r).map((x) => [String(x.day), num(x.n)]));
    const c = byDay(carts), k = byDay(checkouts), o = byDay(orders), g = byDay(ga4);
    const today = new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
    const days: DayPoint[] = [];
    for (let i = 179; i >= 0; i--) {
      const day = new Date(Date.parse(`${today}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
      const sessions = g.get(day) ?? 0;
      const ord = o.get(day) ?? 0;
      days.push({ day, carts: c.get(day) ?? 0, checkouts: k.get(day) ?? 0, orders: ord, sessions, ordersOnGa4Day: g.has(day) ? ord : 0 });
    }
    const e = rows(econ)[0] ?? {};
    const m = new Map(rows(micro).map((x) => [String(x.k), { n: num(x.n), converted: num(x.converted) }]));
    return {
      days,
      paidOrders: num(e.paid_orders),
      aovUgx: num(e.aov),
      marginPerPaidOrderUgx: num(e.margin),
      costCoverage: num(e.coverage),
      micro: MICRO_CONVERSIONS.map((mc) => ({ key: mc.key, label: mc.label, n: m.get(mc.key)?.n ?? 0, converted: m.get(mc.key)?.converted ?? 0 })),
    };
  }
}
