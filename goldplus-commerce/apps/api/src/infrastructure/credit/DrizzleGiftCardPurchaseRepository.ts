import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { outboxEvents } from '../db/schema/system';
import { customerOutboxValues } from '../notifications/CustomerOutboxNotifier';
import type { GiftCardOutboxMessage, GiftCardPurchaseRecord, IGiftCardPurchaseRepository } from '../../application/ports/IGiftCardPurchaseRepository';

const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, any>>;
const at = (v: unknown) => (v ? new Date(v as string) : null);
const isoDate = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

function record(r: Record<string, any>): GiftCardPurchaseRecord {
  return {
    id: String(r.id), reference: r.reference, amountUgx: Number(r.amount_ugx), buyerName: r.buyer_name, buyerPhone: r.buyer_phone,
    buyerEmail: r.buyer_email ?? null, buyerUserId: r.buyer_user_id ?? null, fromName: r.from_name, recipientName: r.recipient_name,
    recipientPhone: r.recipient_phone ?? null, sendTo: r.send_to, message: r.message ?? null, deliverOn: isoDate(r.deliver_on),
    status: r.status, orderTrackingId: r.order_tracking_id ?? null, redirectUrl: r.redirect_url ?? null, providerStatus: r.provider_status ?? null,
    confirmationCode: r.confirmation_code ?? null, paymentMethod: r.payment_method ?? null, instrumentId: r.instrument_id ?? null,
    cardLast4: r.card_last4 ?? null, createdAt: new Date(r.created_at), paidAt: at(r.paid_at), issuedAt: at(r.issued_at),
  };
}

const SELECT = sql.raw(`select p.*, i.code_last4 as card_last4 from gift_card_purchases p left join credit_instruments i on i.id = p.instrument_id`);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The outbox row for a gift card message, written with the same writer (and encoding) as every customer message. */
async function enqueueInTx(tx: Tx, m: GiftCardOutboxMessage, relatedEntityId: string): Promise<void> {
  const values = customerOutboxValues({
    eventType: 'CUSTOMER_ORDER_MESSAGE', template: m.template, customerPhone: m.phone, customerEmail: m.email ?? null, data: m.data,
    idempotencyKey: m.idempotencyKey, relatedEntity: m.relatedEntity, relatedEntityId,
  });
  if (values) await tx.insert(outboxEvents).values(values).onConflictDoNothing({ target: outboxEvents.idempotencyKey });
}

/** 0199: gift cards bought online. Every status change is a compare-and-set on the current status. */
export class DrizzleGiftCardPurchaseRepository implements IGiftCardPurchaseRepository {
  async create(input: Parameters<IGiftCardPurchaseRepository['create']>[0]): Promise<GiftCardPurchaseRecord> {
    const [r] = rowsOf(await db.execute(sql`
      insert into gift_card_purchases (reference, amount_ugx, buyer_name, buyer_phone, buyer_email, buyer_user_id, from_name,
                                       recipient_name, recipient_phone, send_to, message, deliver_on)
      values (${input.reference}, ${input.amountUgx}, ${input.buyerName}, ${input.buyerPhone}, ${input.buyerEmail}, ${input.buyerUserId},
              ${input.fromName}, ${input.recipientName}, ${input.recipientPhone}, ${input.sendTo}, ${input.message}, ${input.deliverOn}::date)
      returning *`));
    return record(r);
  }

  private async one(where: ReturnType<typeof sql>): Promise<GiftCardPurchaseRecord | null> {
    const [r] = rowsOf(await db.execute(sql`${SELECT} where ${where} limit 1`));
    return r ? record(r) : null;
  }
  byReference(reference: string) { return this.one(sql`p.reference = ${reference}`); }
  byTrackingId(trackingId: string) { return this.one(sql`p.order_tracking_id = ${trackingId}`); }

  async recordStarted(id: string, trackingId: string, redirectUrl: string): Promise<void> {
    await db.execute(sql`update gift_card_purchases set order_tracking_id = ${trackingId}, redirect_url = ${redirectUrl}, updated_at = now()
                         where id = ${id} and order_tracking_id is null`);
  }

  async buyerActivity(buyerPhone: string, since: Date): Promise<{ started: number; paidUgx: number }> {
    const last9 = buyerPhone.replace(/\D/g, '').slice(-9);
    const [r] = rowsOf(await db.execute(sql`
      select count(*)::int as started,
             coalesce(sum(amount_ugx) filter (where status in ('paid','issued')), 0)::bigint as paid
        from gift_card_purchases
       where right(regexp_replace(buyer_phone, '\\D', '', 'g'), 9) = ${last9} and created_at >= ${since}`));
    return { started: Number(r?.started ?? 0), paidUgx: Number(r?.paid ?? 0) };
  }

  async paidSince(since: Date): Promise<number> {
    const [r] = rowsOf(await db.execute(sql`select coalesce(sum(amount_ugx), 0)::bigint as paid from gift_card_purchases
                                             where status in ('paid','issued') and paid_at >= ${since}`));
    return Number(r?.paid ?? 0);
  }

  async markPaid(id: string, input: { confirmationCode: string | null; paymentMethod: string | null; providerStatus: string; now: Date }, receipt: GiftCardOutboxMessage | null): Promise<boolean> {
    return db.transaction(async (tx) => {
      const rows = rowsOf(await tx.execute(sql`
        update gift_card_purchases
           set status = 'paid', paid_at = ${input.now}, confirmation_code = ${input.confirmationCode}, payment_method = ${input.paymentMethod},
               provider_status = ${input.providerStatus}, updated_at = now()
         where id = ${id} and status in ('awaiting_payment','failed','abandoned')
        returning id`));
      if (rows.length === 0) return false;
      if (receipt) await enqueueInTx(tx, receipt, id);
      return true;
    });
  }

  async markUnpaid(id: string, status: 'failed' | 'abandoned' | 'review', providerStatus: string): Promise<boolean> {
    const rows = rowsOf(await db.execute(sql`
      update gift_card_purchases set status = ${status}, provider_status = ${providerStatus.slice(0, 300)}, updated_at = now()
       where id = ${id} and (status = 'awaiting_payment' or (${status} = 'review' and status in ('failed','abandoned'))) returning id`));
    return rows.length > 0;
  }

  async issueCard(input: Parameters<IGiftCardPurchaseRepository['issueCard']>[0]): Promise<{ instrumentId: string } | null> {
    return db.transaction(async (tx) => {
      const [p] = rowsOf(await tx.execute(sql`
        select id, amount_ugx from gift_card_purchases where id = ${input.purchaseId} and status = 'paid' and instrument_id is null for update`));
      if (!p) return null;
      const [card] = rowsOf(await tx.execute(sql`
        insert into credit_instruments (kind, code_hash, code_last4, status, initial_value_ugx, reason, recipient_name, recipient_phone,
                                        customer_user_id, source_order_id, issued_by, expires_at, approved_by, approved_at)
        values ('gift_card', ${input.codeHash}, ${input.last4}, 'active', ${Number(p.amount_ugx)}, ${input.reason}, ${input.recipientName},
                ${input.recipientPhone}, ${input.customerUserId}, null, ${input.issuedBy}, null, ${input.issuedBy}, ${input.now})
        returning id`));
      const instrumentId = String(card.id);
      await tx.execute(sql`insert into credit_ledger (instrument_id, type, amount_ugx, actor_id, note)
                           values (${instrumentId}, 'ISSUE', ${Number(p.amount_ugx)}, ${input.issuedBy}, ${input.reason})`);
      await tx.execute(sql`update gift_card_purchases set status = 'issued', instrument_id = ${instrumentId}, issued_at = ${input.now}, updated_at = now()
                           where id = ${input.purchaseId}`);
      for (const m of input.messages) await enqueueInTx(tx, m, m.relatedEntityId ?? instrumentId);
      return { instrumentId };
    });
  }

  async paidNotIssued(limit: number) {
    return rowsOf(await db.execute(sql`${SELECT} where p.status = 'paid' and p.instrument_id is null order by p.deliver_on nulls first, p.paid_at limit ${limit}`)).map(record);
  }
  async awaitingWithTransaction(olderThan: Date, newerThan: Date, limit: number) {
    return rowsOf(await db.execute(sql`${SELECT} where p.status = 'awaiting_payment' and p.order_tracking_id is not null
                                        and p.created_at <= ${olderThan} and p.created_at >= ${newerThan} order by p.created_at limit ${limit}`)).map(record);
  }
  async awaitingStale(olderThan: Date, limit: number) {
    return rowsOf(await db.execute(sql`${SELECT} where p.status = 'awaiting_payment' and p.created_at < ${olderThan} order by p.created_at limit ${limit}`)).map(record);
  }
  async forBuyer(userId: string, limit: number) {
    return rowsOf(await db.execute(sql`${SELECT} where p.buyer_user_id = ${userId} and p.status in ('paid','issued','refunded','review') order by p.created_at desc limit ${limit}`)).map(record);
  }
  async recent(limit: number) {
    return rowsOf(await db.execute(sql`${SELECT} order by p.created_at desc limit ${limit}`)).map(record);
  }
  async markRefunded(id: string, note: string, opts?: { unissuedOnly?: boolean }): Promise<boolean> {
    const rows = rowsOf(await db.execute(sql`
      update gift_card_purchases set status = 'refunded', provider_status = ${note}, updated_at = now()
       where id = ${id} and status in ('paid','issued','review') ${opts?.unissuedOnly ? sql`and instrument_id is null` : sql``} returning id`));
    return rows.length > 0;
  }
}
