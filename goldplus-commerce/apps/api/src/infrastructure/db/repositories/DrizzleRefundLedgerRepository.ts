import { sql } from 'drizzle-orm';
import { guardedMeasurementWrite, recordRefundSettled } from '../../measurement/BusinessEventWriter';
import { db } from '../client';
import type {
  IRefundLedgerRepository,
  RecordedRefund,
  RefundLineAllocation,
  ReserveRefundOutcome,
} from '../../../application/ports/IRefundLedgerRepository';
import { pgUuidArray } from '../PgParams';

/**
 * The provider's own word that it ACCEPTED a refund request (RefundRequest
 * answers `status: "200"`). Only such a row is money the provider is moving.
 * A row whose call threw (PROVIDER_CALL_FAILED) or that was never sent is
 * still reserved against the balance, but a later REVERSED poll proves
 * nothing about it — PesaPal reports REVERSED per transaction, and keeps
 * reporting it after the first reversal lands.
 */
export const PROVIDER_ACCEPTED_STATUS = '200';

/** Rejections where provably nothing reached the provider, so the same key may try again. */
export const NOTHING_SENT_PROVIDER_STATUSES = ['STATUS_LOOKUP_FAILED', 'NO_CONFIRMATION_CODE'] as const;

/**
 * Which outstanding accepted refunds a REVERSED status proves landed: the one
 * outstanding row, and only on the first observation (nothing settled yet).
 * Anything else is ambiguous and is left for a person.
 */
export function refundsProvenByReversal(outstandingAcceptedIds: string[], alreadySettledCount: number): string[] {
  return outstandingAcceptedIds.length === 1 && alreadySettledCount === 0 ? [...outstandingAcceptedIds] : [];
}

/** Refunded share in basis points, floored and capped at the whole. */
export function refundedShareBps(refundedUgx: number, collectedUgx: number): number {
  if (!(collectedUgx > 0) || !(refundedUgx > 0)) return 0;
  return Math.min(10_000, Math.floor((refundedUgx * 10_000) / collectedUgx));
}

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
      // The key index is global, but a key only ever speaks for ITS payment.
      // Reused on another order it used to answer ALREADY_PROCESSED with the
      // other order's refund: ok:true, nothing sent, nothing recorded here.
      if (existingRow && String(existingRow.payment_attempt_id) !== input.paymentAttemptId) {
        return { outcome: 'KEY_CONFLICT' } as const;
      }
      // A rejection where nothing ever reached the provider ("Nothing was
      // sent; try again shortly") is not a payout. An identical retry on the
      // derived key used to answer ALREADY_PROCESSED — ok:true, no refund sent.
      // Such a row is re-armed below, after the balance is re-checked.
      const rearm =
        existingRow &&
        String(existingRow.status) === 'rejected' &&
        (NOTHING_SENT_PROVIDER_STATUSES as readonly string[]).includes(String(existingRow.provider_status ?? ''));
      if (existingRow && !rearm) {
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

      const inserted: any = rearm
        ? await tx.execute(sql`
            update payment_refunds
            set status = 'requested', provider_status = null, provider_message = null,
                amount_ugx = ${input.amountUgx}, reason = ${input.reason}, requested_by = ${input.requestedBy}::uuid
            where id = ${String(existingRow.id)}::uuid and status = 'rejected'
            returning *
          `)
        : await tx.execute(sql`
        insert into payment_refunds
          (payment_attempt_id, order_id, idempotency_key, amount_ugx, reason, status, requested_by)
        values
          (${input.paymentAttemptId}::uuid, ${input.orderId}::uuid, ${input.idempotencyKey},
           ${input.amountUgx}, ${input.reason}, 'requested', ${input.requestedBy}::uuid)
        returning *
      `);
      if (rearm) {
        // The re-armed request carries THIS call's line allocation.
        await tx.execute(sql`delete from payment_refund_lines where refund_id = ${String(existingRow.id)}::uuid`);
      }
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
    await db.transaction(async (tx) => {
      const current: any = await tx.execute(sql`
        select status from payment_refunds where id = ${refundId}::uuid for update
      `);
      const currentRow = Array.isArray(current) ? current[0] : current?.rows?.[0];
      if (!currentRow) return;
      const wasSettled = String(currentRow.status) === 'settled';
      // Never downgrade a settled row. The reconcile poller can settle a row in
      // the gap between the reservation committing and RequestRefund being
      // answered; writing 'requested' back over it moved settled→requested and
      // then settled again, with a second REFUND entry. A settled row is final:
      // nothing is written at all, not even the late answer's provider status
      // and message, which would otherwise overwrite the settling answer's.
      if (wasSettled) return;
      const nextStatus = update.status;
      await tx.execute(sql`
        update payment_refunds
        set status = ${nextStatus},
            provider_status = ${update.providerStatus ?? null},
            provider_message = ${update.providerMessage ?? null},
            settled_at = case when ${nextStatus} = 'settled' and settled_at is null then now() else settled_at end
        where id = ${refundId}::uuid
      `);
      // refund_confirmed + REFUND ledger entry in the same transaction (0140),
      // only when the row actually BECAME settled here; guarded so measurement
      // can never block recording a refund (D-008).
      if (nextStatus === 'settled' && !wasSettled) {
        await guardedMeasurementWrite(tx as never, refundId, 'refund_settled', (sp) => recordRefundSettled(sp, refundId, new Date()));
      }
    });
  }

  /**
   * Money the provider has returned or accepted to return — the reading of a
   * REVERSED status as partial or total. A reservation the provider never
   * accepted (its call failed, or it was never sent) is not counted: with it,
   * a partial reversal plus an unsent refund summing to the collected amount
   * read as TOTAL, cancelled the order and clawed back all its loyalty.
   * (reserveRefund keeps counting every non-rejected row: that is the
   * double-payout guard, and it is deliberately stricter.)
   */
  async getRefundedTotalUgx(paymentAttemptId: string): Promise<number> {
    const rows: any = await db.execute(sql`
      select coalesce(sum(amount_ugx), 0)::bigint as refunded
      from payment_refunds
      where payment_attempt_id = ${paymentAttemptId}::uuid
        and (status = 'settled' or (status = 'requested' and provider_status = ${PROVIDER_ACCEPTED_STATUS}))
    `);
    const row = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
    return Number(row?.refunded ?? 0);
  }

  async getRefundedShareBpsForOrder(orderId: string): Promise<number> {
    const rows: any = await db.execute(sql`
      select
        coalesce(sum(pa.amount), 0)::bigint as collected,
        coalesce(sum((
          select coalesce(sum(pr.amount_ugx), 0)
          from payment_refunds pr
          where pr.payment_attempt_id = pa.id
            and (pr.status = 'settled' or (pr.status = 'requested' and pr.provider_status = ${PROVIDER_ACCEPTED_STATUS}))
        )), 0)::bigint as refunded
      from payment_attempts pa
      where pa.order_id = ${orderId}::uuid and pa.status in ('completed', 'reversed')
    `);
    const row = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
    return refundedShareBps(Number(row?.refunded ?? 0), Number(row?.collected ?? 0));
  }

  async hasOutstandingRefunds(paymentAttemptId: string): Promise<boolean> {
    const rows: any = await db.execute(sql`
      select 1 from payment_refunds
      where payment_attempt_id = ${paymentAttemptId}::uuid and status = 'requested'
        and provider_status = ${PROVIDER_ACCEPTED_STATUS}
      limit 1
    `);
    return (Array.isArray(rows) ? rows : rows?.rows ?? []).length > 0;
  }

  /**
   * Settle the outstanding refund a REVERSED status can only be reporting.
   *
   * PesaPal reports REVERSED per TRANSACTION and keeps reporting it after the
   * first reversal lands, so the status names no refund. It is proof about a
   * refund only when exactly one provider-accepted row is outstanding and
   * nothing on the attempt has settled before (this is the first REVERSED
   * observation). Any other shape is ambiguous: the rows stay 'requested'
   * for a person to resolve against the provider (ResolveRefundUseCase).
   *
   * This used to settle oldest first against a "collected minus settled"
   * budget. reserveRefund already keeps every non-rejected row inside the
   * collected amount, so that budget always covered every accepted row and
   * capped nothing: one REVERSED reading settled refunds nobody saw land.
   */
  async settleRefundsForAttempt(paymentAttemptId: string): Promise<number> {
    return db.transaction(async (tx) => {
      // Only refunds the provider ACCEPTED can be what a REVERSED status is
      // reporting. A row whose provider call threw, that the provider refused,
      // or that is still between reservation and request stays 'requested'
      // for a person to resolve (or for its own acceptance to be recorded).
      const pending: any = await tx.execute(sql`
        select id from payment_refunds
        where payment_attempt_id = ${paymentAttemptId}::uuid and status = 'requested'
          and provider_status = ${PROVIDER_ACCEPTED_STATUS}
        order by created_at asc
        for update
      `);
      const rows = Array.isArray(pending) ? pending : pending?.rows ?? [];
      const settledBefore: any = await tx.execute(sql`
        select count(*)::int as settled
        from payment_refunds
        where payment_attempt_id = ${paymentAttemptId}::uuid and status = 'settled'
      `);
      const settledRows = Array.isArray(settledBefore) ? settledBefore : settledBefore?.rows ?? [];
      const settleIds = refundsProvenByReversal(rows.map((r: any) => String(r.id)), Number(settledRows[0]?.settled ?? 0));
      if (settleIds.length === 0) return 0;

      await tx.execute(sql`
        update payment_refunds
        set status = 'settled', settled_at = now()
        where id = any(${pgUuidArray(settleIds)})
      `);
      for (const id of settleIds) {
        await guardedMeasurementWrite(tx as never, id, 'refund_settled', (sp) => recordRefundSettled(sp, id, new Date()));
      }
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
