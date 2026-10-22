import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/**
 * Paid orders still owed a confirmed-payment effect, for ReconcilePendingPaymentsUseCase's catch-up.
 *
 * Paid through a COMPLETED attempt (never a hand-marked COD order), and either:
 *   - the fulfilment task never learned it was paid (and is still live); or
 *   - for an attempt completed inside the window, on a live order: the customer's receipt, or the paid-order
 *     alert for one of `alertRecipients`, has no outbox row.
 *
 * Those effects run inline after the stage commit, so one DB blip, or a container replaced after the first
 * effect, lost them for good: a replayed IPN answers ALREADY_SETTLED and runs nothing. Every outbox check is an
 * exact idempotency key (unique index), the same keys the effects write, so a re-run inserts only what is
 * missing. The window on the ATTEMPT keeps an old order touched today from getting a late "payment received".
 */
export async function listPaidOrdersOwedConfirmedEffects(since: Date, limit: number, alertRecipients: string[]): Promise<string[]> {
  const missingAlert = alertRecipients.length
    ? sql.join(alertRecipients.map((r) => sql`or not exists (select 1 from outbox_events e where e.idempotency_key = 'fulfilment-alert:' || o.id::text || ':' || ${r})`), sql` `)
    : sql``;
  const rows = (await db.execute(sql`
    select o.id
    from orders o
    left join fulfilment_tasks t on t.order_id = o.id
    where o.payment_status = 'paid'
      and o.updated_at >= ${since}
      and exists (select 1 from payment_attempts pa where pa.order_id = o.id and pa.status = 'completed')
      and (
        -- A gift card / store credit hold still 'held' on a paid order: its capture was lost (it runs once, inline).
        exists (select 1 from credit_ledger l where l.order_id = o.id and l.type = 'HOLD' and l.hold_state = 'held')
        or (t.id is not null and t.payment_status <> 'paid' and t.status not in ('CANCELLED', 'DELIVERED'))
        or (
          o.status not in ('cancelled', 'delivered', 'completed', 'failed')
          and exists (select 1 from payment_attempts pa where pa.order_id = o.id and pa.status = 'completed' and pa.updated_at >= ${since})
          and (
            not exists (select 1 from outbox_events e where e.idempotency_key = 'customer-order-message:' || o.id::text || ':ORDER_PAYMENT_SUCCESS')
            ${missingAlert}
          )
        )
      )
    order by o.updated_at desc
    limit ${Math.max(1, Math.min(limit, 200))}
  `)) as unknown as Array<{ id: string }>;
  return rows.map((r) => String(r.id));
}
