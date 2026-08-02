import { sql } from 'drizzle-orm';
import { db } from '../client';
import { ICustomerRfmRepository } from '../../../application/ports/ICustomerRfmRepository';
import { RfmInput } from '../../../domain/customer-dna/Rfm';

export class DrizzleCustomerRfmRepository implements ICustomerRfmRepository {
  async aggregateCustomers(limit: number): Promise<RfmInput[]> {
    // Monetary and recency are computed from PAID orders only — an unpaid or
    // failed order is intent, not revenue, and must not inflate a customer's M
    // score or reset their recency.
    const rows = (await db.execute(sql`
      select o.user_id as customer_id,
             max(o.created_at) as last_order_at,
             count(*)::int as order_count,
             coalesce(sum(o.total_amount), 0) as total_spend
      from orders o
      where o.user_id is not null and o.payment_status = 'paid'
      group by o.user_id
      order by total_spend desc
      limit ${limit}
    `)) as unknown as any[];
    return rows.map((r) => ({
      customerId: String(r.customer_id),
      lastOrderAt: r.last_order_at ? new Date(r.last_order_at) : null,
      orderCount: Number(r.order_count ?? 0),
      totalSpendUgx: Number(r.total_spend ?? 0),
    }));
  }
}
