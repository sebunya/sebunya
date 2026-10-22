import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { IUnpaidOrderReminderCandidates } from '../../application/ports/IUnpaidOrderReminderCandidates';

export class DrizzleUnpaidOrderReminderCandidates implements IUnpaidOrderReminderCandidates {
  async findDue(input: { placedBefore: Date; placedAfter: Date; limit: number }): Promise<string[]> {
    const rows = (await db.execute(sql`
      select o.id
        from orders o
       where o.payment_method = 'pesapal'
         -- 'failed': a declined Mobile Money prompt is unpaid too, and the most common case worth one reminder.
         and o.payment_status in ('unpaid', 'failed')
         -- Nothing left to pay (a gift card covers it): never "please pay".
         and o.total_amount > o.store_credit_applied_ugx
         and o.status in ('received', 'pending_payment')
         and o.created_at <= ${input.placedBefore.toISOString()}
         and o.created_at > ${input.placedAfter.toISOString()}
         -- A payment that is clearing (or cleared) must never be met with "please pay".
         and not exists (
           select 1 from payment_attempts a
            where a.order_id = o.id
              -- A 'pending' attempt is clearing only while it is fresh or the provider has just spoken about it: one
              -- opened at checkout and left untouched for half an hour is a payment page nobody finished. Counting
              -- every pending attempt excluded nearly every order, so the reminder almost never went (2026-10-22).
              and (a.status in ('verification_pending', 'completed')
                   -- (updated_at moves on every poll, so it says nothing; only the IPN or the callback is the provider speaking.)
                   or (a.status = 'pending' and greatest(a.created_at, a.ipn_received_at, a.callback_received_at) > now() - interval '30 minutes')))
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
