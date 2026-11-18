import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { IStaleOrderReader } from '../../../application/use-cases/payments/PaymentOpsSweepUseCases';

/**
 * Stale-order reads for the payment-ops sweeps (order abandonment and the
 * reservation TTL). The pending-attempt exclusion is the rule, and so is COD
 * safety: only online-prepaid orders are ever swept by time.
 *
 * Moved out of the Registry, 2026-11: the queries are exactly those the
 * Registry held.
 */
export class DrizzleStaleOrderReader implements IStaleOrderReader {
  async listStaleUnpaidOrders(olderThan: Date, limit: number) {
    return (await db.execute(sql`
      select o.id, o.order_number as "orderNumber", o.status, o.created_at as "createdAt"
      from orders o
      where o.payment_status in ('unpaid', 'failed')
        and o.status in ('received', 'pending_payment')
        and o.created_at < ${olderThan}
        -- Only online-prepaid orders are abandoned by time. A pay-on-delivery
        -- ('offline') or legacy/admin (NULL) order is unpaid by design and must
        -- never be auto-cancelled. payment_method is recorded at checkout
        -- (migration 0130) and backfilled to 'pesapal' for historical orders
        -- that have a payment attempt.
        and o.payment_method = 'pesapal'
        and not exists (
          select 1 from payment_attempts a
          where a.order_id = o.id
            -- 'completed': money the provider confirmed. Even if the order never moved (a crash between the
            -- attempt write and the order transition), it is never cancelled or released by time.
            and a.status in ('pending', 'verification_pending', 'verification_failed', 'completed')
        )
        -- 0222: an order being paid in parts (deposit in) is unpaid by design until its balance is in; the plan
        -- holds its stock and closes it on its own date (PayInPartsUseCases.sweep).
        and not exists (select 1 from layby_plans lp where lp.order_id = o.id and lp.status in ('active', 'paid'))
      order by o.created_at limit ${limit}`)) as unknown as Array<{
      id: string; orderNumber: string; status: string; createdAt: Date;
    }>;
  }

  async listReservedUnpaidOrders(olderThan: Date, limit: number) {
    return (await db.execute(sql`
      select distinct o.id, o.order_number as "orderNumber", o.created_at as "createdAt"
      from orders o join inventory_reservations r on r.order_id = o.id and r.status = 'reserved'
      where o.payment_status in ('unpaid', 'failed')
        and o.status in ('received', 'pending_payment')
        and o.created_at < ${olderThan}
        -- Same COD safety as listStaleUnpaidOrders: a pay-on-delivery order
        -- holds a reservation and is unpaid by design; its stock must not be
        -- returned to sale by the TTL sweep. Only online-prepaid orders qualify.
        and o.payment_method = 'pesapal'
        and not exists (
          select 1 from payment_attempts a
          where a.order_id = o.id
            -- 'completed': money the provider confirmed. Even if the order never moved (a crash between the
            -- attempt write and the order transition), it is never cancelled or released by time.
            and a.status in ('pending', 'verification_pending', 'verification_failed', 'completed')
        )
        -- 0222: an order being paid in parts (deposit in) is unpaid by design until its balance is in; the plan
        -- holds its stock and closes it on its own date (PayInPartsUseCases.sweep).
        and not exists (select 1 from layby_plans lp where lp.order_id = o.id and lp.status in ('active', 'paid'))
      order by o.created_at limit ${limit}`)) as unknown as Array<{
      id: string; orderNumber: string; createdAt: Date;
    }>;
  }
}
