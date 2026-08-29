import { sql } from 'drizzle-orm';
import { db } from '../client';
import type {
  IRefundLedgerRepository,
  RecordedRefund,
  RefundLineAllocation,
  ReserveRefundOutcome,
} from '../../../application/ports/IRefundLedgerRepository';
import { pgUuidArray } from '../PgParams';

const toRecordedRefund = (row: any): RecordedRefund => ({
  id: String(row.id),
  paymentAttemptId: String(row.payment_attempt_id),
  orderId: String(row.order_id),
  idempotencyKey: String(row.idempotency_key),
  amountUgx: Number(row.amount_ugx),
  reason: String(row.reason),
  status: String(row.status) as RecordedRefund['status'],
  providerStatus: row.provider_status === null || row.provider_status === undefined ? null : String(row.provider_status),
  providerMessage: row.provider_message === null || row.provider_message === undefined ? null : String(row.provider_message),
  createdAt: new Date(row.created_at),
});

/**
 * The refund ledger (0103).
 *
 * `reserveRefund` is the whole point: it is ONE transaction that locks the
 * payment attempt, recomputes the refunded total under that lock, and only
 * then inserts. Two concurrent requests for 60% of the same payment cannot
 * both succeed, because the second blocks on the lock and then re-reads a
 * total that already contains the first.
 *
 * A 'requested' refund counts against the balance exactly like a settled one.
 * Money handed to the provider is not headroom, and treating it as headroom is
 * precisely how a double payout happens.
 */
export class DrizzleRefundLedgerRepository implements IRefundLedgerRepository {
  async reserveRefund(input: {
    paymentAttemptId: string;
    orderId: string;
    collectedUgx: number;
    idempotencyKey: string;
    amountUgx: number;
    reason: string;
    requestedBy: string;
    lines: RefundLineAllocation[];
  }): Promise<ReserveRefundOutcome> {
    return db.transaction(async (tx) => {
      // Serialise every refund decision for this attempt behind one lock.
      await tx.execute(
        sql`select id from payment_attempts where id = ${input.paymentAttemptId}::uuid for update`,
      );

      // An already-used key means the payout was already made (or is in
      // flight). Return the original row and send nothing to the provider.
      const existing: any = await tx.execute(
        sql`select * from payment_refunds where idempotency_key = ${input.idempotencyKey} limit 1`,
      );
      const existingRow = Array.isArray(existing) ? existing[0] : existing?.rows?.[0];
      if (existingRow) {
        return { outcome: 'ALREADY_PROCESSED', refund: toRecordedRefund(existingRow) } as const;
      }

      const totals: any = await tx.execute(sql`
        select coalesce(sum(amount_ugx), 0)::bigint as refunded
        from payment_refunds
        where payment_attempt_id = ${input.paymentAttemptId}::uuid
          and status <> 'rejected'
      `);
      const totalsRow = Array.isArray(totals) ? totals[0] : totals?.rows?.[0];
      const alreadyRefundedUgx = Number(totalsRow?.refunded ?? 0);
      const refundableUgx = input.collectedUgx - alreadyRefundedUgx;

      if (input.amountUgx > refundableUgx) {
        return {
          outcome: 'EXCEEDS_REFUNDABLE_BALANCE',
          collectedUgx: input.collectedUgx,
          alreadyRefundedUgx,
          refundableUgx: Math.max(0, refundableUgx),
        } as const;
      }

      if (input.lines.length > 0) {
        const allocated = input.lines.reduce((sum, line) => sum + line.amountUgx, 0);
        if (allocated !== input.amountUgx) {
          return {
            outcome: 'INVALID_LINE_ALLOCATION',
            message: `Line allocations total ${allocated} but the refund is ${input.amountUgx}. They must match exactly, or be omitted for an order-level refund.`,
          } as const;
        }

        const itemIds = input.lines.map((line) => line.orderItemId);
        const lineRows: any = await tx.execute(sql`
          select oi.id,
                 oi.final_line_total,
                 coalesce((
                   select sum(prl.amount_ugx)
                   from payment_refund_lines prl
                   join payment_refunds pr on pr.id = prl.refund_id
                   where prl.order_item_id = oi.id and pr.status <> 'rejected'
                 ), 0)::bigint as already_refunded
          from order_items oi
          where oi.order_id = ${input.orderId}::uuid
            and oi.id = any(${sql`ARRAY[${sql.join(itemIds.map((id) => sql`${id}::uuid`), sql`, `)}]`})
        `);
        const found = (Array.isArray(lineRows) ? lineRows : lineRows?.rows ?? []) as any[];
        if (found.length !== new Set(itemIds).size) {
          return {
            outcome: 'INVALID_LINE_ALLOCATION',
            message: 'Every allocated line must belong to the order being refunded.',
          } as const;
        }
        const byId = new Map(found.map((row) => [String(row.id), row]));
        for (const line of input.lines) {
          const row = byId.get(line.orderItemId);
          const lineTotal = Number(row?.final_line_total ?? 0);
          const lineAlready = Number(row?.already_refunded ?? 0);
          if (line.amountUgx > lineTotal - lineAlready) {
            return {
              outcome: 'INVALID_LINE_ALLOCATION',
              message: `Line ${line.orderItemId} has ${lineTotal - lineAlready} refundable but ${line.amountUgx} was allocated.`,
            } as const;
          }
        }
      }

      const inserted: any = await tx.execute(sql`
        insert into payment_refunds
          (payment_attempt_id, order_id, idempotency_key, amount_ugx, reason, status, requested_by)
        values
          (${input.paymentAttemptId}::uuid, ${input.orderId}::uuid, ${input.idempotencyKey},
           ${input.amountUgx}, ${input.reason}, 'requested', ${input.requestedBy}::uuid)
        returning *
      `);
      const insertedRow = Array.isArray(inserted) ? inserted[0] : inserted?.rows?.[0];
      const refund = toRecordedRefund(insertedRow);

      for (const line of input.lines) {
        await tx.execute(sql`
          insert into payment_refund_lines (refund_id, order_item_id, amount_ugx)
          values (${refund.id}::uuid, ${line.orderItemId}::uuid, ${line.amountUgx})
        `);
      }

      return { outcome: 'RESERVED', refund } as const;
    });
  }

  async recordProviderOutcome(refundId: string, update: {
    status: 'requested' | 'settled' | 'rejected';
    providerStatus?: string | null;
    providerMessage?: string | null;
  }): Promise<void> {
    await db.execute(sql`
      update payment_refunds
      set status = ${update.status},
          provider_status = ${update.providerStatus ?? null},
          provider_message = ${update.providerMessage ?? null},
          settled_at = case when ${update.status} = 'settled' then now() else settled_at end
      where id = ${refundId}::uuid
    `);
  }

  async getRefundedTotalUgx(paymentAttemptId: string): Promise<number> {
    const rows: any = await db.execute(sql`
      select coalesce(sum(amount_ugx), 0)::bigint as refunded
      from payment_refunds
      where payment_attempt_id = ${paymentAttemptId}::uuid and status <> 'rejected'
    `);
    const row = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
    return Number(row?.refunded ?? 0);
  }

  async hasOutstandingRefunds(paymentAttemptId: string): Promise<boolean> {
    const rows: any = await db.execute(sql`
      select 1 from payment_refunds
      where payment_attempt_id = ${paymentAttemptId}::uuid and status = 'requested'
      limit 1
    `);
    return (Array.isArray(rows) ? rows : rows?.rows ?? []).length > 0;
  }

  /**
   * Settle outstanding refunds against the amount the provider has actually
   * returned, oldest first.
   *
   * This used to settle EVERY 'requested' row on the attempt on a single
   * provider confirmation. With two refunds outstanding and only one really
   * processed, both were marked settled, so the ledger's refunded total then
   * counted money that never left, which in turn skewed the partial-versus-
   * total reversal reading and the revenue projection.
   */
  async settleRefundsForAttempt(paymentAttemptId: string, settledTotalUgx?: number): Promise<number> {
    return db.transaction(async (tx) => {
      const pending: any = await tx.execute(sql`
        select id, amount_ugx from payment_refunds
        where payment_attempt_id = ${paymentAttemptId}::uuid and status = 'requested'
        order by created_at asc
        for update
      `);
      const rows = Array.isArray(pending) ? pending : pending?.rows ?? [];
      if (rows.length === 0) return 0;

      // The caller passes the total the provider has returned across this
      // attempt, which INCLUDES anything settled on an earlier confirmation.
      // Spending that whole figure again would let previously settled refunds
      // pay for these ones, so the cap has to be what is left of it.
      let budget: number;
      if (settledTotalUgx === undefined) {
        // No figure given means the provider confirmed the whole outstanding set.
        budget = Number.POSITIVE_INFINITY;
      } else {
        const settledSoFar: any = await tx.execute(sql`
          select coalesce(sum(amount_ugx), 0)::bigint as settled
          from payment_refunds
          where payment_attempt_id = ${paymentAttemptId}::uuid and status = 'settled'
        `);
        const settledRows = Array.isArray(settledSoFar) ? settledSoFar : settledSoFar?.rows ?? [];
        budget = Math.max(0, settledTotalUgx - Number(settledRows[0]?.settled ?? 0));
      }
      const settleIds: string[] = [];
      for (const r of rows) {
        const amount = Number(r.amount_ugx ?? 0);
        if (amount > budget) break;
        budget -= amount;
        settleIds.push(String(r.id));
      }
      if (settleIds.length === 0) return 0;

      await tx.execute(sql`
        update payment_refunds
        set status = 'settled', settled_at = now()
        where id = any(${pgUuidArray(settleIds)})
      `);
      return settleIds.length;
    });
  }

  async listRefundsForOrder(orderId: string): Promise<RecordedRefund[]> {
    const rows: any = await db.execute(sql`
      select * from payment_refunds where order_id = ${orderId}::uuid order by created_at desc
    `);
    const list = (Array.isArray(rows) ? rows : rows?.rows ?? []) as any[];
    return list.map(toRecordedRefund);
  }
}
