import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { ISalesFunnelReader, SalesFunnelCounts } from '../../../application/ports/ISalesFunnelReader';

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  return ((result as { rows?: Array<Record<string, unknown>> })?.rows ?? []);
}

/**
 * Aggregates only, over indexed columns; no per-customer field leaves the query. Windows are closed [start, end]
 * instants derived from Kampala calendar days by the use case, exactly as Commerce Analytics does.
 */
export class DrizzleSalesFunnelReader implements ISalesFunnelReader {
  async counts(start: Date, end: Date): Promise<SalesFunnelCounts> {
    const result: unknown = await db.execute(sql`
      select
        (select count(distinct coalesce(e.profile_id::text, e.customer_id::text, e.anonymous_id, e.browser_id))::int
           from recommendation_events e
          where e.event_type = 'PRODUCT_VIEWED'
            and coalesce(e.producer, '') <> 'api-engine'
            and coalesce(e.profile_id::text, e.customer_id::text, e.anonymous_id, e.browser_id) is not null
            and e.created_at >= ${start} and e.created_at <= ${end}) as "productViewers",
        (select count(*)::int
           from carts c
          where c.updated_at >= ${start} and c.updated_at <= ${end}
            and exists (select 1 from cart_items i where i.cart_id = c.id)) as "cartsWithItems",
        (select count(*)::int from orders o where o.created_at >= ${start} and o.created_at <= ${end}) as "ordersPlaced",
        (select coalesce(sum(o.total_amount), 0)::bigint from orders o where o.created_at >= ${start} and o.created_at <= ${end}) as "ordersPlacedValueUgx",
        (select count(*)::int from orders o
          where o.created_at >= ${start} and o.created_at <= ${end} and o.payment_status = 'paid') as "ordersPaid",
        (select coalesce(sum(o.total_amount), 0)::bigint from orders o
          where o.created_at >= ${start} and o.created_at <= ${end} and o.payment_status = 'paid') as "ordersPaidValueUgx",
        (select coalesce(sum(o.total_amount), 0)::bigint from orders o
          where o.created_at >= ${start} and o.created_at <= ${end}
            and o.payment_status <> 'paid' and o.status <> 'cancelled') as "unpaidOpenValueUgx",
        (select count(*)::int from cart_abandonments a
          where a.classified_at >= ${start} and a.classified_at <= ${end}) as "abandonedCarts",
        (select coalesce(sum(a.subtotal_ugx), 0)::bigint from cart_abandonments a
          where a.classified_at >= ${start} and a.classified_at <= ${end}) as "abandonedCartValueUgx"
    `);
    const r = rowsOf(result)[0] ?? {};
    const n = (k: string) => Number(r[k] ?? 0);
    return {
      productViewers: n('productViewers'),
      cartsWithItems: n('cartsWithItems'),
      ordersPlaced: n('ordersPlaced'),
      ordersPlacedValueUgx: n('ordersPlacedValueUgx'),
      ordersPaid: n('ordersPaid'),
      ordersPaidValueUgx: n('ordersPaidValueUgx'),
      unpaidOpenValueUgx: n('unpaidOpenValueUgx'),
      abandonedCarts: n('abandonedCarts'),
      abandonedCartValueUgx: n('abandonedCartValueUgx'),
    };
  }
}
