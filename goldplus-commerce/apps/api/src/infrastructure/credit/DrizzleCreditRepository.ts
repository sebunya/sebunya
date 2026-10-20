import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { CreditInstrumentView, CreditLedgerRow, ICreditRepository } from '../../application/ports/ICreditRepository';
import type { CreditKind } from '../../domain/credit/CreditInstrument';

const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, any>>;

/** The balance of an instrument: every ledger row except released holds (CreditInstrument.availableBalance, in SQL). */
const BALANCE = sql.raw(`coalesce((select sum(l.amount_ugx) from credit_ledger l where l.instrument_id = i.id and not (l.type = 'HOLD' and l.hold_state = 'released')), 0)`);

function view(r: Record<string, any>): CreditInstrumentView {
  return {
    id: r.id, kind: r.kind as CreditKind, last4: r.code_last4, status: r.status, initialValueUgx: Number(r.initial_value_ugx),
    balanceUgx: Math.max(0, Number(r.balance ?? 0)), reason: r.reason, recipientName: r.recipient_name ?? null, recipientPhone: r.recipient_phone ?? null,
    customerUserId: r.customer_user_id ?? null, issuedBy: r.issued_by, approvedBy: r.approved_by ?? null,
    createdAt: new Date(r.created_at), expiresAt: r.expires_at ? new Date(r.expires_at) : null,
  };
}

/**
 * 0196: hold store credit against an order INSIDE the transaction that saves the order (DrizzleOrderRepository
 * .savePricedOrder), under the instrument's row lock, so two orders can never spend one balance and an order
 * never exists with its hold half-written. Throws a named error (rolling the order back) when the card cannot
 * pay: STORE_CREDIT_UNAVAILABLE (unknown, void, waiting for approval, expired) or STORE_CREDIT_EMPTY.
 * Returns what was held, which is never more than the balance or the order total.
 */
export async function holdStoreCreditInTx(
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown>; update?: unknown },
  input: { codeHash: string; orderId: string; orderTotalUgx: number; maxUgx?: number | null },
): Promise<number> {
  const [inst] = rowsOf(await tx.execute(sql`
    select i.id, i.status, i.expires_at, ${BALANCE} as balance
      from credit_instruments i where i.code_hash = ${input.codeHash} for update`));
  if (!inst || inst.status !== 'active' || (inst.expires_at && new Date(inst.expires_at) <= new Date())) throw new Error('STORE_CREDIT_UNAVAILABLE');
  const applied = Math.min(Math.max(0, Number(inst.balance)), input.orderTotalUgx, input.maxUgx ?? Number.MAX_SAFE_INTEGER);
  if (applied <= 0) throw new Error('STORE_CREDIT_EMPTY');
  await tx.execute(sql`insert into credit_ledger (instrument_id, type, amount_ugx, hold_state, order_id, note)
                       values (${inst.id}, 'HOLD', ${-applied}, 'held', ${input.orderId}, 'Checkout')`);
  await tx.execute(sql`update orders set store_credit_applied_ugx = ${applied}, store_credit_instrument_id = ${inst.id} where id = ${input.orderId}`);
  return applied;
}

/**
 * Every change to an instrument's money takes the instrument's row lock first (select … for update), so two
 * orders, an order and a void, or an order and a refund never interleave on one balance.
 */
export class DrizzleCreditRepository implements ICreditRepository {
  async issue(input: Parameters<ICreditRepository['issue']>[0]): Promise<{ id: string }> {
    return db.transaction(async (tx) => {
      const [row] = rowsOf(await tx.execute(sql`
        insert into credit_instruments (kind, code_hash, code_last4, status, initial_value_ugx, reason, recipient_name, recipient_phone,
                                        customer_user_id, source_order_id, issued_by, expires_at, approved_by, approved_at)
        values (${input.kind}, ${input.codeHash}, ${input.last4}, ${input.status}, ${input.valueUgx}, ${input.reason}, ${input.recipientName},
                ${input.recipientPhone}, ${input.customerUserId}, ${input.sourceOrderId}, ${input.issuedBy}, ${input.expiresAt},
                ${input.status === 'active' ? input.issuedBy : null}, ${input.status === 'active' ? new Date() : null})
        returning id`));
      await tx.execute(sql`insert into credit_ledger (instrument_id, type, amount_ugx, actor_id, note, order_id)
                           values (${row.id}, 'ISSUE', ${input.valueUgx}, ${input.issuedBy}, ${input.reason}, ${input.sourceOrderId})`);
      return { id: String(row.id) };
    });
  }

  private async one(where: ReturnType<typeof sql>): Promise<CreditInstrumentView | null> {
    const [r] = rowsOf(await db.execute(sql`select i.*, ${BALANCE} as balance from credit_instruments i where ${where} limit 1`));
    return r ? view(r) : null;
  }

  findByCodeHash(codeHash: string) { return this.one(sql`i.code_hash = ${codeHash}`); }
  findById(id: string) { return this.one(sql`i.id = ${id}`); }

  async list(input: { limit: number; status?: string | null; kind?: CreditKind | null }): Promise<CreditInstrumentView[]> {
    const rows = rowsOf(await db.execute(sql`
      select i.*, ${BALANCE} as balance from credit_instruments i
       where (${input.status ?? null}::text is null or i.status = ${input.status ?? null})
         and (${input.kind ?? null}::text is null or i.kind = ${input.kind ?? null})
       order by i.created_at desc limit ${Math.max(1, Math.min(input.limit, 300))}`));
    return rows.map(view);
  }

  async forCustomer(userId: string): Promise<CreditInstrumentView[]> {
    return rowsOf(await db.execute(sql`select i.*, ${BALANCE} as balance from credit_instruments i where i.customer_user_id = ${userId} and i.status <> 'void' order by i.created_at desc limit 50`)).map(view);
  }

  async ledger(instrumentId: string): Promise<CreditLedgerRow[]> {
    return rowsOf(await db.execute(sql`
      select l.type, l.amount_ugx, l.hold_state, l.note, l.created_at, o.order_number
        from credit_ledger l left join orders o on o.id = l.order_id
       where l.instrument_id = ${instrumentId} order by l.created_at desc limit 200`)).map((r) => ({
      type: r.type, amountUgx: Number(r.amount_ugx), holdState: r.hold_state ?? null, orderNumber: r.order_number ?? null, note: r.note ?? null, createdAt: new Date(r.created_at),
    }));
  }

  async approve(id: string, approverId: string, now: Date): Promise<boolean> {
    // The issuer can never approve their own instrument (checked in SQL, not only in the use case).
    const r = rowsOf(await db.execute(sql`update credit_instruments set status = 'active', approved_by = ${approverId}, approved_at = ${now}
                                           where id = ${id} and status = 'pending_approval' and issued_by <> ${approverId} returning id`));
    return r.length === 1;
  }

  async voidInstrument(id: string, actorId: string, note: string, now: Date): Promise<number | null> {
    return db.transaction(async (tx) => {
      const [i] = rowsOf(await tx.execute(sql`select i.id, i.status, ${BALANCE} as balance from credit_instruments i where i.id = ${id} for update`));
      if (!i || i.status === 'void') return null;
      // Held money belongs to an order in progress: voiding takes only what is free; the order's hold stays.
      const left = Math.max(0, Number(i.balance));
      if (left > 0) await tx.execute(sql`insert into credit_ledger (instrument_id, type, amount_ugx, actor_id, note) values (${id}, 'VOID', ${-left}, ${actorId}, ${note})`);
      await tx.execute(sql`update credit_instruments set status = 'void', voided_by = ${actorId}, voided_at = ${now} where id = ${id}`);
      return left;
    });
  }

  async adjust(id: string, amountUgx: number, actorId: string, note: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [i] = rowsOf(await tx.execute(sql`select i.id, i.status, ${BALANCE} as balance from credit_instruments i where i.id = ${id} for update`));
      if (!i || i.status === 'void' || Number(i.balance) + amountUgx < 0) return false;
      await tx.execute(sql`insert into credit_ledger (instrument_id, type, amount_ugx, actor_id, note) values (${id}, 'ADJUST', ${amountUgx}, ${actorId}, ${note})`);
      return true;
    });
  }

  async captureForOrder(orderId: string, now: Date): Promise<number> {
    const r = rowsOf(await db.execute(sql`update credit_ledger set hold_state = 'captured', settled_at = ${now}
                                           where order_id = ${orderId} and type = 'HOLD' and hold_state = 'held' returning amount_ugx`));
    return r.reduce((s, x) => s - Number(x.amount_ugx), 0);
  }

  async releaseOrReturnForOrder(orderId: string, note: string, now: Date): Promise<{ released: number; returned: number }> {
    return db.transaction(async (tx) => {
      const holds = rowsOf(await tx.execute(sql`select id, instrument_id, amount_ugx, hold_state from credit_ledger
                                                 where order_id = ${orderId} and type = 'HOLD' and hold_state <> 'released' for update`));
      let released = 0;
      let returned = 0;
      for (const h of holds) {
        await tx.execute(sql`select id from credit_instruments where id = ${h.instrument_id} for update`);
        if (h.hold_state === 'held') {
          await tx.execute(sql`update credit_ledger set hold_state = 'released', settled_at = ${now} where id = ${h.id}`);
          released += -Number(h.amount_ugx);
        } else {
          // Captured: the order was paid and is now cancelled (a full refund). Give the credit back, exactly once.
          const [already] = rowsOf(await tx.execute(sql`select 1 from credit_ledger where order_id = ${orderId} and instrument_id = ${h.instrument_id} and type = 'RETURN' limit 1`));
          if (!already) {
            await tx.execute(sql`insert into credit_ledger (instrument_id, type, amount_ugx, order_id, note) values (${h.instrument_id}, 'RETURN', ${-Number(h.amount_ugx)}, ${orderId}, ${note})`);
            returned += -Number(h.amount_ugx);
          }
        }
      }
      return { released, returned };
    });
  }
}
