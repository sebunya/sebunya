import { sql } from 'drizzle-orm';
import { db } from '../client';
import {
  AnalyticsDailyBucket,
  AnalyticsOrderAggregates,
  AnalyticsSearchSummary,
  AnalyticsSourceRecency,
  IAnalyticsReadRepository,
} from '../../../application/ports/IAnalyticsReadRepository';

function rowsOf(result: unknown): any[] {
  return Array.isArray(result) ? result : ((result as { rows?: any[] })?.rows ?? []);
}

/**
 * Bounded PostgreSQL aggregation for Commerce Analytics.
 *
 * Day bucketing converts created_at to Africa/Kampala before truncating, so a
 * 21:30 UTC order lands on the next Kampala day exactly as the shared period
 * service expects. Time windows are always closed [start, end] instants that
 * the use case derives from Kampala calendar days; queries are aggregates
 * over indexed columns and return no per-customer fields.
 */
export class DrizzleAnalyticsReadRepository implements IAnalyticsReadRepository {
  async orderAggregates(start: Date, end: Date): Promise<AnalyticsOrderAggregates> {
    const result: any = await db.execute(sql`
      select
        count(*)::int as "orders",
        count(*) filter (where payment_status = 'paid')::int as "paidOrders",
        coalesce(sum(total_amount) filter (where payment_status = 'paid'), 0)::bigint as "paidOrderValueUgx",
        coalesce(sum(total_amount), 0)::bigint as "grossOrderValueUgx",
        coalesce(sum(pricing_discount_total), 0)::bigint as "discountValueUgx",
        coalesce(sum(delivery_fee), 0)::bigint as "deliveryFeeValueUgx",
        count(*) filter (where payment_status in ('failed', 'rejected', 'cancelled'))::int as "failedPayments",
        count(*) filter (where status = 'completed')::int as "completedOrders",
        count(*) filter (where status = 'cancelled')::int as "cancelledOrders"
      from orders
      where created_at >= ${start} and created_at <= ${end}
    `);
    const row = rowsOf(result)[0] ?? {};
    return {
      orders: Number(row.orders ?? 0),
      paidOrders: Number(row.paidOrders ?? 0),
      paidOrderValueUgx: Number(row.paidOrderValueUgx ?? 0),
      grossOrderValueUgx: Number(row.grossOrderValueUgx ?? 0),
      discountValueUgx: Number(row.discountValueUgx ?? 0),
      deliveryFeeValueUgx: Number(row.deliveryFeeValueUgx ?? 0),
      failedPayments: Number(row.failedPayments ?? 0),
      completedOrders: Number(row.completedOrders ?? 0),
      cancelledOrders: Number(row.cancelledOrders ?? 0),
    };
  }

  async dailyOrderBuckets(start: Date, end: Date): Promise<AnalyticsDailyBucket[]> {
    const result: any = await db.execute(sql`
      select
        to_char((created_at at time zone 'Africa/Kampala')::date, 'YYYY-MM-DD') as "day",
        count(*)::int as "orders",
        count(*) filter (where payment_status = 'paid')::int as "paidOrders",
        coalesce(sum(total_amount) filter (where payment_status = 'paid'), 0)::bigint as "paidOrderValueUgx"
      from orders
      where created_at >= ${start} and created_at <= ${end}
      group by 1
      order by 1
    `);
    return rowsOf(result).map((row) => ({
      day: String(row.day),
      orders: Number(row.orders ?? 0),
      paidOrders: Number(row.paidOrders ?? 0),
      paidOrderValueUgx: Number(row.paidOrderValueUgx ?? 0),
    }));
  }

  async lowStockCount(): Promise<number> {
    // Mirrors domain isLowStock(): reorder_point <= 0 disables the alert and
    // available-to-promise clamps at zero.
    const result: any = await db.execute(sql`
      select count(*)::int as "lowStock"
      from products
      where reorder_point > 0
        and greatest(stock_quantity - reserved_quantity, 0) <= reorder_point
    `);
    return Number(rowsOf(result)[0]?.lowStock ?? 0);
  }

  async searchDemandSummary(): Promise<AnalyticsSearchSummary> {
    const result: any = await db.execute(sql`
      select
        coalesce(sum(search_count), 0)::bigint as "totalSearches",
        coalesce(sum(zero_result_count), 0)::bigint as "zeroResultSearches",
        max(last_searched_at) as "lastSignalAt"
      from search_demand_signals
    `);
    const row = rowsOf(result)[0] ?? {};
    return {
      totalSearches: Number(row.totalSearches ?? 0),
      zeroResultSearches: Number(row.zeroResultSearches ?? 0),
      lastSignalAt: row.lastSignalAt ? new Date(row.lastSignalAt) : null,
    };
  }

  async sourceRecency(): Promise<AnalyticsSourceRecency> {
    const result: any = await db.execute(sql`
      select
        (select max(created_at) from orders) as "lastOrderAt",
        (select max(created_at) from payment_attempts) as "lastPaymentAttemptAt",
        (select max(last_searched_at) from search_demand_signals) as "lastSearchSignalAt"
    `);
    const row = rowsOf(result)[0] ?? {};
    return {
      lastOrderAt: row.lastOrderAt ? new Date(row.lastOrderAt) : null,
      lastPaymentAttemptAt: row.lastPaymentAttemptAt ? new Date(row.lastPaymentAttemptAt) : null,
      lastSearchSignalAt: row.lastSearchSignalAt ? new Date(row.lastSearchSignalAt) : null,
    };
  }
}
