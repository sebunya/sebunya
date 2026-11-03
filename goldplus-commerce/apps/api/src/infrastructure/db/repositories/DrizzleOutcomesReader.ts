import { sql } from 'drizzle-orm';
import { TELEMETRY_TRUSTED_FROM, TELEMETRY_TRUSTED_FROM_DAY } from '../../../domain/measurement/Outcomes';
import { db } from '../client';
import type { IOutcomesReader, OutcomeCounts } from '../../../application/ports/IOutcomesReader';
import type { MicroConversionKey, SegmentRow } from '../../../domain/measurement/Outcomes';

const rows = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const num = (v: unknown): number => Number(v ?? 0) || 0;
/**
 * The telemetry outbox holds the event as a JSON STRING inside jsonb on production (2026-11-03: every row's
 * payload->>'event_name' read NULL), so the payload is unwrapped before a key is read. Kept in step with the
 * partial index in 0216 (same expression), or the planner cannot use it.
 */
const EV = sql.raw(`(case when jsonb_typeof(o.payload) = 'string' then (o.payload #>> '{}')::jsonb else o.payload end)`);

/**
 * Bounded aggregates for the Outcomes page (2026-11-03). Every query is a count or a sum over the window; the only
 * per-row list is paid order totals (whales) and per-order journey summaries, both capped by the period. Checkout
 * starts come from the telemetry outbox (begin_checkout, one per browser), carts from the carts table, journeys
 * from measurement.order_touch_link, GA4 figures from the shop's own copy of the daily series.
 */
export class DrizzleOutcomesReader implements IOutcomesReader {
  async counts(requestedStart: Date, end: Date, requestedStartDay: string, endDay: string): Promise<OutcomeCounts> {
    // Nothing before the trusted day is counted (see TELEMETRY_TRUSTED_FROM): the whole window moves, so every
    // rate's two halves still cover the same days.
    const clipped = requestedStart < TELEMETRY_TRUSTED_FROM;
    const start = clipped ? TELEMETRY_TRUSTED_FROM : requestedStart;
    const startDay = requestedStartDay < TELEMETRY_TRUSTED_FROM_DAY ? TELEMETRY_TRUSTED_FROM_DAY : requestedStartDay;
    const endX = new Date(end.getTime() + 1);
    const [base, paid, journeys, micro, spend, ga4Totals, byChannel, byDevice] = await Promise.all([
      db.execute(sql`
        select
          (select count(*)::int from carts c where c.updated_at >= ${start} and c.updated_at < ${endX} and not c.is_probe
             and exists (select 1 from cart_items i where i.cart_id = c.id)) as "cartsWithItems",
          (select count(distinct coalesce(${EV}->'user_data'->>'fp_client_id', o.id::text))::int from outbox_events o
            where o.event_type = 'TELEMETRY_DISPATCH' and ${EV}->>'event_name' = 'begin_checkout'
              and o.created_at >= ${start} and o.created_at < ${endX}) as "checkoutsStarted",
          (select count(*)::int from orders o where o.created_at >= ${start} and o.created_at < ${endX}) as "ordersPlaced"`),
      db.execute(sql`select o.total_amount::bigint as total from orders o
        where o.created_at >= ${start} and o.created_at < ${endX} and o.payment_status = 'paid' order by o.created_at`),
      db.execute(sql`select min(t.occurred_at) as first_touch_at, o.created_at as order_at, count(*)::int as touches
        from orders o join measurement.order_touch_link l on l.order_id = o.id join measurement.touchpoint t on t.touch_id = l.touch_id
        where o.created_at >= ${start} and o.created_at < ${endX} and t.occurred_at <= o.created_at
        group by o.id, o.created_at`),
      db.execute(sql`
        select
          (select count(*)::int from users u where u.created_at >= ${start} and u.created_at < ${endX}) as sign_up,
          (select count(*)::int from product_questions q where q.created_at >= ${start} and q.created_at < ${endX}) as product_question,
          (select count(*)::int from battery_requests b where b.created_at >= ${start} and b.created_at < ${endX}) as battery_request,
          (select count(*)::int from quote_requests q where q.created_at >= ${start} and q.created_at < ${endX}) as quote_request,
          (select count(*)::int from dealer_applications d where d.created_at >= ${start} and d.created_at < ${endX}) as dealer_application,
          (select count(*)::int from gift_card_purchases g where g.paid_at >= ${start} and g.paid_at < ${endX}) as gift_card_purchase,
          (select count(*)::int from wishlists w where w.added_at >= ${start} and w.added_at < ${endX}) as wishlist_add`),
      db.execute(sql`select coalesce(sum(spend_minor), 0)::bigint as spend from measurement.mmm_daily where day >= ${startDay}::date and day <= ${endDay}::date`),
      db.execute(sql`select coalesce(sum(sessions), 0)::int as sessions, count(distinct day)::int as days, max(day)::text as last_day,
          coalesce(sum(sessions) filter (where dimension like '(direct)%'), 0)::int as direct
        from measurement.ga4_daily_series where report = 'source_medium' and day >= ${startDay}::date and day <= ${endDay}::date`),
      db.execute(sql`select dimension, sum(sessions)::int as sessions, sum(new_users)::int as new_users, sum(total_users)::int as total_users,
          sum(purchases)::int as purchases, sum(purchase_revenue_minor)::bigint as revenue
        from measurement.ga4_daily_series where report = 'channel' and day >= ${startDay}::date and day <= ${endDay}::date group by dimension`),
      db.execute(sql`select dimension, sum(sessions)::int as sessions, sum(new_users)::int as new_users, sum(total_users)::int as total_users,
          sum(purchases)::int as purchases, sum(purchase_revenue_minor)::bigint as revenue
        from measurement.ga4_daily_series where report = 'device' and day >= ${startDay}::date and day <= ${endDay}::date group by dimension`),
    ]);
    const b = rows(base)[0] ?? {};
    const m = rows(micro)[0] ?? {};
    const microCounts: Partial<Record<MicroConversionKey, number>> = {
      sign_up: num(m.sign_up), product_question: num(m.product_question), battery_request: num(m.battery_request), quote_request: num(m.quote_request),
      dealer_application: num(m.dealer_application), gift_card_purchase: num(m.gift_card_purchase), wishlist_add: num(m.wishlist_add),
    };
    const seg = (r: unknown): SegmentRow[] => rows(r).map((x) => ({
      segment: String(x.dimension ?? '(not set)'), sessions: num(x.sessions), newUsers: num(x.new_users), totalUsers: num(x.total_users), purchases: num(x.purchases), revenueUgx: num(x.revenue),
    }));
    const g = rows(ga4Totals)[0] ?? {};
    const lastDay = g.last_day ? String(g.last_day) : null;
    // Orders on the GA4-covered Kampala days only: GA4 fills a day in up to two days late, so orders placed today
    // would otherwise be divided by sessions that GA4 has not reported yet.
    const covered = lastDay
      ? num(rows(await db.execute(sql`select count(*)::int as n from orders o where o.created_at >= ${start}
          and o.created_at < ((${lastDay}::date + 1)::timestamp at time zone 'Africa/Kampala') and o.created_at < ${endX}`))[0]?.n)
      : 0;
    return {
      countedFrom: clipped && end > TELEMETRY_TRUSTED_FROM ? TELEMETRY_TRUSTED_FROM_DAY : null,
      cartsWithItems: num(b.cartsWithItems),
      checkoutsStarted: num(b.checkoutsStarted),
      ordersPlaced: num(b.ordersPlaced),
      paidTotalsUgx: rows(paid).map((r) => num(r.total)),
      journeys: rows(journeys).map((r) => ({ firstTouchAt: new Date(r.first_touch_at), orderAt: new Date(r.order_at), touches: num(r.touches) })),
      micro: microCounts,
      spendUgx: num(rows(spend)[0]?.spend),
      ga4: { sessions: num(g.sessions), directSessions: num(g.direct), daysCovered: num(g.days), lastDay, ordersInCoveredDays: covered, byChannel: seg(byChannel), byDevice: seg(byDevice) },
    };
  }
}
