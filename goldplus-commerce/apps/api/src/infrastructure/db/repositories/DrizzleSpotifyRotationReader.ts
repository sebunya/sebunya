import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { SpotifyRotationReader } from '../../../application/ports/SpotifyRotation';
import type { MarketEvent } from '../../../domain/products/ProductMarketHistory';

const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

/**
 * Reads for the Spotify ad rotation preview. Public price and stock history
 * only (product_market_events, 0169); order counts only, never a customer.
 * Before 0169 is applied the history table does not exist: that is reported
 * as historySince = null, and the planner then claims no drop or restock.
 */
export class DrizzleSpotifyRotationReader implements SpotifyRotationReader {
  async facts(productIds: string[], now: Date) {
    const events: Record<string, MarketEvent[]> = {};
    const createdAt: Record<string, Date> = {};
    const orders30d: Record<string, number> = {};
    const spotifyOrders30d: Record<string, number> = {};
    if (!productIds.length) return { events, createdAt, orders30d, spotifyOrders30d, historySince: null };
    const ids = sql.join(productIds.map((id) => sql`${id}::uuid`), sql`, `);
    const windowStart = new Date(now.getTime() - 90 * 86_400_000);
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

    let historySince: Date | null = null;
    const exists = rowsOf(await db.execute(sql`select to_regclass('public.product_market_events') is not null as ok`))[0]?.ok;
    if (exists) {
      const rows = rowsOf(await db.execute(sql`
        select product_id, at, price_ugx, stock_status, published, changed from product_market_events
         where product_id in (${ids}) and at >= ${windowStart}
        union all
        select distinct on (product_id) product_id, at, price_ugx, stock_status, published, changed from product_market_events
         where product_id in (${ids}) and at < ${windowStart}
         order by product_id, at desc`));
      for (const r of rows) {
        (events[String(r.product_id)] ??= []).push({
          at: new Date(r.at), priceUgx: Number(r.price_ugx), stockStatus: String(r.stock_status),
          published: Boolean(r.published), changed: Array.isArray(r.changed) ? r.changed.map(String) : [],
        });
      }
      const first = rowsOf(await db.execute(sql`select min(at) as at from product_market_events where 'BASELINE' = any(changed)`))[0]?.at;
      historySince = first ? new Date(first) : null;
    }

    for (const r of rowsOf(await db.execute(sql`select id, created_at from products where id in (${ids})`))) createdAt[String(r.id)] = new Date(r.created_at);

    for (const r of rowsOf(await db.execute(sql`
      select oi.product_id,
             count(distinct o.id)::int as orders,
             count(distinct o.id) filter (where lower(coalesce(oa.source, '')) like '%spotify%')::int as spotify
        from orders o
        join order_items oi on oi.order_id = o.id
        left join order_attribution oa on oa.order_id = o.id
       -- A sale as the rest of advertising counts one (DrizzleAdvertisingOpsRepository):
       -- delivered or completed (cash on delivery is paid at the door), or paid
       -- and not cancelled or failed. "paid" alone missed every delivered COD
       -- order and showed no product as selling (2026-10-06).
       where (o.status in ('delivered', 'completed') or (o.payment_status = 'paid' and o.status not in ('cancelled', 'failed')))
         and o.created_at >= ${monthAgo} and oi.product_id in (${ids})
       group by oi.product_id`))) {
      orders30d[String(r.product_id)] = Number(r.orders);
      spotifyOrders30d[String(r.product_id)] = Number(r.spotify);
    }
    return { events, createdAt, orders30d, spotifyOrders30d, historySince };
  }
}
