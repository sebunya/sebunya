import { sql } from 'drizzle-orm';
import { db } from '../client';
import {
  AnalyticsDailyBucket,
  AnalyticsFulfilmentExceptionRow,
  AnalyticsOrderAggregates,
  AnalyticsPaymentAggregates,
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

  /**
   * Payment-attempt ledger aggregates.
   *
   * The status vocabulary mirrors ReconcileOrderPaymentUseCase exactly —
   * confirmed/failed/pending allowlists, everything else counted as
   * `unrecognised` rather than silently folded into a bucket it does not
   * belong in. A rising unrecognised count is how a provider changing its
   * status strings becomes visible instead of quietly distorting the rate.
   */
  async paymentAggregates(start: Date, end: Date): Promise<AnalyticsPaymentAggregates> {
    const totals: any = await db.execute(sql`
      select
        count(*)::int as "attempts",
        count(*) filter (where lower(pa.status) in ('completed', 'paid', 'success'))::int as "confirmed",
        count(*) filter (where lower(pa.status) in ('failed', 'cancelled', 'invalid', 'reversed'))::int as "failed",
        count(*) filter (where lower(pa.status) in ('pending', 'verification_pending', 'processing', 'not_started'))::int as "pending",
        count(*) filter (where lower(pa.status) not in (
          'completed', 'paid', 'success',
          'failed', 'cancelled', 'invalid', 'reversed',
          'pending', 'verification_pending', 'processing', 'not_started'
        ))::int as "unrecognised",
        count(*) filter (where pa.callback_received_at is not null)::int as "callbackReceived",
        count(*) filter (where pa.ipn_received_at is not null)::int as "ipnReceived",
        count(*) filter (where o.payment_status = 'paid')::int as "reconciled"
      from payment_attempts pa
      left join orders o on o.id = pa.order_id
      where pa.created_at >= ${start} and pa.created_at <= ${end}
    `);
    const row = rowsOf(totals)[0] ?? {};

    const statuses: any = await db.execute(sql`
      select lower(status) as "status", count(*)::int as "count"
      from payment_attempts
      where created_at >= ${start} and created_at <= ${end}
      group by 1
      order by 2 desc
      limit 50
    `);

    const providers: any = await db.execute(sql`
      select
        lower(provider) as "provider",
        count(*)::int as "attempts",
        count(*) filter (where lower(status) in ('completed', 'paid', 'success'))::int as "confirmed"
      from payment_attempts
      where created_at >= ${start} and created_at <= ${end}
      group by 1
      order by 2 desc
      limit 20
    `);

    return {
      attempts: Number(row.attempts ?? 0),
      confirmed: Number(row.confirmed ?? 0),
      failed: Number(row.failed ?? 0),
      pending: Number(row.pending ?? 0),
      unrecognised: Number(row.unrecognised ?? 0),
      callbackReceived: Number(row.callbackReceived ?? 0),
      ipnReceived: Number(row.ipnReceived ?? 0),
      reconciled: Number(row.reconciled ?? 0),
      byStatus: rowsOf(statuses).map((s) => ({ status: String(s.status), count: Number(s.count) })),
      byProvider: rowsOf(providers).map((p) => ({
        provider: String(p.provider),
        attempts: Number(p.attempts),
        confirmed: Number(p.confirmed),
      })),
    };
  }

  /**
   * Paid orders that never reached processing. Deliberately projects the order
   * number and state only: the drilldown exists to route an operator to the
   * order module, not to become a second customer-data surface.
   */
  async paidNotProcessingOrders(start: Date, end: Date, limit: number, now: Date): Promise<AnalyticsFulfilmentExceptionRow[]> {
    const bounded = Math.max(1, Math.min(limit, 200));
    const result: any = await db.execute(sql`
      select
        order_number as "orderNumber",
        status as "orderStatus",
        payment_status as "paymentStatus",
        extract(epoch from (${now}::timestamptz - created_at)) / 3600 as "ageHours",
        total_amount as "totalAmount"
      from orders
      where created_at >= ${start} and created_at <= ${end}
        and payment_status = 'paid'
        and status in ('received', 'pending')
      order by created_at asc
      limit ${bounded}
    `);
    return rowsOf(result).map((row) => ({
      orderNumber: String(row.orderNumber),
      orderStatus: String(row.orderStatus),
      paymentStatus: String(row.paymentStatus),
      ageHours: Math.round(Number(row.ageHours ?? 0) * 10) / 10,
      totalAmount: Number(row.totalAmount ?? 0),
    }));
  }

  /** Bounded breakdown. The dimension is an allowlisted column, never free text. */
  async ordersByDimension(start: Date, end: Date, dimension: 'payment_status' | 'status') {
    const column = dimension === 'payment_status' ? sql`payment_status` : sql`status`;
    const result: any = await db.execute(sql`
      select
        ${column} as "value",
        count(*)::int as "orders",
        coalesce(sum(total_amount) filter (where payment_status = 'paid'), 0)::bigint as "paidOrderValueUgx"
      from orders
      where created_at >= ${start} and created_at <= ${end}
      group by 1
      order by 2 desc
      limit 50
    `);
    return rowsOf(result).map((row) => ({
      value: String(row.value),
      orders: Number(row.orders ?? 0),
      paidOrderValueUgx: Number(row.paidOrderValueUgx ?? 0),
    }));
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
