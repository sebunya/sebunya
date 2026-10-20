import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { IUnpaidOrderReminderCandidates } from '../../application/ports/IUnpaidOrderReminderCandidates';

export class DrizzleUnpaidOrderReminderCandidates implements IUnpaidOrderReminderCandidates {
  async findDue(input: { placedBefore: Date; placedAfter: Date; limit: number }): Promise<string[]> {
    const rows = (await db.execute(sql`
      select o.id
        from orders o
       where o.payment_method = 'pesapal'
         and o.payment_status = 'unpaid'
         and o.status in ('received', 'pending_payment')
         and o.created_at <= ${input.placedBefore.toISOString()}
         and o.created_at > ${input.placedAfter.toISOString()}
         -- A payment that is clearing (or cleared) must never be met with "please pay".
         and not exists (
           select 1 from payment_attempts a
            where a.order_id = o.id
              and a.status in ('pending', 'verification_pending', 'completed'))
         and not exists (
           select 1 from payments p
            where p.order_id = o.id)
         -- They ordered again (and may have paid): this order is not the one to chase.
         and not exists (
           select 1 from orders o2
            where o2.customer_phone = o.customer_phone
              and o2.id <> o.id
              and o2.created_at > o.created_at)
         and not exists (
           select 1 from care_tasks t
            where t.order_number = o.order_number and t.status = 'open')
         and not exists (
           select 1 from outbox_events x
            where x.idempotency_key = 'customer-order-message:' || o.id::text || ':ORDER_PAYMENT_REMINDER')
       order by o.created_at
       limit ${input.limit}
    `)) as unknown as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }
}
