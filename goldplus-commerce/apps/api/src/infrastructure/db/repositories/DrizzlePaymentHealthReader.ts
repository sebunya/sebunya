import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { IPaymentHealthReader } from '../../../application/use-cases/payments/PaymentSilenceUseCases';

/**
 * The payment-health reads: when money last landed, provider callback silence,
 * and the four funnel counters. A gap between adjacent counters IS the outage.
 *
 * Moved out of the Registry, 2026-11: the queries are exactly those the
 * Registry held.
 */
export class DrizzlePaymentHealthReader implements IPaymentHealthReader {
  async lastSuccessfulPaymentAt(): Promise<Date | null> {
    const rows = (await db.execute(sql`
      select max(updated_at) as t from payment_attempts where status = 'completed'`)) as unknown as Array<{ t: string | null }>;
    return rows[0]?.t ? new Date(rows[0].t) : null;
  }

  async callbackSilence(olderThan: Date, since: Date) {
    const [row] = (await db.execute(sql`
      select
        count(*)::int as total,
        count(*) filter (
          where ipn_received_at is null and callback_received_at is null
        )::int as awaiting
      from payment_attempts
      where created_at >= ${since}
        and created_at <= ${olderThan}
        and order_tracking_id is not null`)) as unknown as Array<{ total: number; awaiting: number }>;
    return { awaiting: row?.awaiting ?? 0, total: row?.total ?? 0 };
  }

  async funnel(since: Date) {
    const [row] = (await db.execute(sql`
      select
        (select count(*) from checkout_idempotency where created_at >= ${since})::int as started,
        (select count(*) from payment_attempts where created_at >= ${since})::int as requested,
        (select count(*) from payment_attempts where status = 'completed' and updated_at >= ${since})::int as succeeded,
        (select count(*) from orders where payment_status = 'paid' and updated_at >= ${since})::int as paid`)) as unknown as Array<{
      started: number; requested: number; succeeded: number; paid: number;
    }>;
    return {
      checkoutStarted: row?.started ?? 0,
      paymentRequested: row?.requested ?? 0,
      paymentSucceeded: row?.succeeded ?? 0,
      orderPaid: row?.paid ?? 0,
    };
  }
}
