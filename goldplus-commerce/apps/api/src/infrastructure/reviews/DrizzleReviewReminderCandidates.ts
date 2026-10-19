import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { IReviewReminderCandidates } from '../../application/ports/IReviewReminderCandidates';

export class DrizzleReviewReminderCandidates implements IReviewReminderCandidates {
  async findDue(input: { closedBefore: Date; closedAfter: Date; limit: number }): Promise<string[]> {
    const rows = (await db.execute(sql`
      select o.id
        from orders o
        join lateral (
          select max(e.occurred_at) as closed_at
            from order_events e
           where e.order_id = o.id
             and e.to_status in ('delivered', 'completed')
             and e.is_synthetic = false
        ) c on true
       where o.status in ('delivered', 'completed')
         and o.payment_status <> 'reversed'
         and c.closed_at <= ${input.closedBefore.toISOString()}
         and c.closed_at > ${input.closedAfter.toISOString()}
         and not exists (
           select 1 from reviews r join order_items oi on oi.id = r.order_item_id
            where oi.order_id = o.id)
         and not exists (
           select 1 from care_tasks t
            where t.order_number = o.order_number and t.status = 'open')
         and not exists (
           select 1 from outbox_events x
            where x.idempotency_key = 'customer-order-message:' || o.id::text || ':ORDER_REVIEW_REMINDER')
       order by c.closed_at
       limit ${input.limit}
    `)) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
}
