import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { outboxEvents } from '../db/schema/system';
import { customerOutboxValues } from '../notifications/CustomerOutboxNotifier';
import type { ILaybyRepository, LaybyOutboxMessage, LaybyPaidOutcome, LaybyPaymentRecord, LaybyPlanRecord } from '../../application/ports/ILaybyRepository';
import { DAY_MS } from '../../domain/layby/PayInParts';

const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, any>>;
const at = (v: unknown) => (v ? new Date(v as string) : null);
const intArray = (v: unknown): number[] => {
  if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
  const s = String(v ?? '').replace(/[{}]/g, '').trim();
  return s ? s.split(',').map(Number).filter(Number.isFinite) : [];
};
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function plan(r: Record<string, any>): LaybyPlanRecord {
  return {
    id: String(r.id), orderId: String(r.order_id), orderNumber: r.order_number, customerName: r.customer_name ?? null, customerPhone: r.customer_phone,
    totalUgx: Number(r.total_ugx), depositUgx: Number(r.deposit_ugx), paidUgx: Number(r.paid_ugx), depositPercent: Number(r.deposit_percent),
    termDays: Number(r.term_days), feePercent: Number(r.fee_percent), status: r.status, depositPaidAt: at(r.deposit_paid_at), dueAt: at(r.due_at),
    remindersSent: intArray(r.reminders_sent), completedAt: at(r.completed_at), closedAt: at(r.closed_at), closeReason: r.close_reason ?? null,
    feeUgx: num(r.fee_ugx), refundUgx: num(r.refund_ugx), createdAt: new Date(r.created_at),
  };
}

function payment(r: Record<string, any>): LaybyPaymentRecord {
  return {
    id: String(r.id), planId: String(r.plan_id), reference: r.reference, kind: r.kind, amountUgx: Number(r.amount_ugx), status: r.status,
    orderTrackingId: r.order_tracking_id ?? null, redirectUrl: r.redirect_url ?? null, confirmationCode: r.confirmation_code ?? null,
    paymentMethod: r.payment_method ?? null, createdAt: new Date(r.created_at), paidAt: at(r.paid_at),
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The outbox row, with the same writer (and encoding) as every customer message. */
async function enqueueInTx(tx: Tx, m: LaybyOutboxMessage, planId: string): Promise<void> {
  const values = customerOutboxValues({
    eventType: 'CUSTOMER_ORDER_MESSAGE', template: m.template, customerPhone: m.phone, customerEmail: null, data: m.data,
    idempotencyKey: m.idempotencyKey, relatedEntity: 'layby_plan', relatedEntityId: planId,
  });
  if (values) await tx.insert(outboxEvents).values(values).onConflictDoNothing({ target: outboxEvents.idempotencyKey });
}

/** 0222: pay in parts. Every status change is a compare-and-set on the current status. */
export class DrizzleLaybyRepository implements ILaybyRepository {
  async settings(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const r of rowsOf(await db.execute(sql`select key, value from layby_settings`))) out[String(r.key)] = String(r.value);
    return out;
  }

  async saveSetting(key: string, value: string, actorId: string): Promise<void> {
    await db.execute(sql`insert into layby_settings (key, value, updated_by, updated_at) values (${key}, ${value}, ${actorId}, now())
                         on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`);
  }

  private async onePlan(where: ReturnType<typeof sql>): Promise<LaybyPlanRecord | null> {
    const [r] = rowsOf(await db.execute(sql`select * from layby_plans where ${where} limit 1`));
    return r ? plan(r) : null;
  }
  planByOrderId(orderId: string) { return this.onePlan(sql`order_id = ${orderId}`); }
  planById(id: string) { return this.onePlan(sql`id = ${id}`); }

  async createPlan(input: Parameters<ILaybyRepository['createPlan']>[0]): Promise<LaybyPlanRecord> {
    await db.execute(sql`
      insert into layby_plans (order_id, order_number, customer_name, customer_phone, total_ugx, deposit_ugx, deposit_percent, term_days, fee_percent)
      values (${input.orderId}, ${input.orderNumber}, ${input.customerName}, ${input.customerPhone}, ${input.totalUgx}, ${input.depositUgx},
              ${input.depositPercent}, ${input.termDays}, ${input.feePercent})
      on conflict (order_id) do nothing`);
    const p = await this.planByOrderId(input.orderId);
    if (!p) throw new Error('LAYBY_PLAN_NOT_CREATED');
    return p;
  }

  async list(f: { status: string | null; limit: number }): Promise<LaybyPlanRecord[]> {
    const where = f.status ? sql`where status = ${f.status}` : sql``;
    return rowsOf(await db.execute(sql`select * from layby_plans ${where} order by created_at desc limit ${f.limit}`)).map(plan);
  }

  async paymentsFor(planId: string): Promise<LaybyPaymentRecord[]> {
    return rowsOf(await db.execute(sql`select * from layby_payments where plan_id = ${planId} order by created_at`)).map(payment);
  }

  async createPayment(input: { planId: string; reference: string; kind: 'deposit' | 'instalment'; amountUgx: number }): Promise<LaybyPaymentRecord> {
    const [r] = rowsOf(await db.execute(sql`
      insert into layby_payments (plan_id, reference, kind, amount_ugx) values (${input.planId}, ${input.reference}, ${input.kind}, ${input.amountUgx})
      returning *`));
    return payment(r);
  }

  async recordStarted(paymentId: string, trackingId: string, redirectUrl: string): Promise<void> {
    await db.execute(sql`update layby_payments set order_tracking_id = ${trackingId}, redirect_url = ${redirectUrl}, updated_at = now()
                         where id = ${paymentId} and order_tracking_id is null`);
  }

  private async onePayment(where: ReturnType<typeof sql>): Promise<LaybyPaymentRecord | null> {
    const [r] = rowsOf(await db.execute(sql`select * from layby_payments where ${where} limit 1`));
    return r ? payment(r) : null;
  }
  paymentByTrackingId(trackingId: string) { return this.onePayment(sql`order_tracking_id = ${trackingId}`); }
  paymentByReference(reference: string) { return this.onePayment(sql`reference = ${reference}`); }

  async openDeposit(planId: string, amountUgx: number, since: Date): Promise<LaybyPaymentRecord | null> {
    const [r] = rowsOf(await db.execute(sql`
      select * from layby_payments where plan_id = ${planId} and kind = 'deposit' and amount_ugx = ${amountUgx}
         and status = 'awaiting_payment' and redirect_url is not null and created_at > ${since}
       order by created_at desc limit 1`));
    return r ? payment(r) : null;
  }

  async markPaymentPaid(paymentId: string, input: { confirmationCode: string | null; paymentMethod: string | null; providerStatus: string; now: Date },
    receipt: (plan: LaybyPlanRecord) => LaybyOutboxMessage): Promise<LaybyPaidOutcome | null> {
    return db.transaction(async (tx) => {
      const [p] = rowsOf(await tx.execute(sql`
        update layby_payments set status = 'paid', paid_at = ${input.now}, confirmation_code = ${input.confirmationCode},
               payment_method = ${input.paymentMethod}, provider_status = ${input.providerStatus}, updated_at = now()
         where id = ${paymentId} and status in ('awaiting_payment','failed','abandoned')
        returning plan_id, amount_ugx`));
      if (!p) return null;
      const [before] = rowsOf(await tx.execute(sql`select * from layby_plans where id = ${p.plan_id} for update`));
      const was = plan(before);
      const paid = was.paidUgx + Number(p.amount_ugx);
      const open = was.status === 'awaiting_deposit' || was.status === 'active';
      const starts = was.status === 'awaiting_deposit';
      const completes = open && paid >= was.totalUgx;
      const due = starts ? new Date(input.now.getTime() + was.termDays * DAY_MS) : was.dueAt;
      const [after] = rowsOf(await tx.execute(sql`
        update layby_plans
           set paid_ugx = ${paid},
               status = ${completes ? 'paid' : starts ? 'active' : was.status},
               deposit_paid_at = coalesce(deposit_paid_at, ${starts ? input.now : null}),
               due_at = ${due},
               completed_at = ${completes ? input.now : was.completedAt},
               updated_at = now()
         where id = ${was.id}
        returning *`));
      const now = plan(after);
      await enqueueInTx(tx, receipt(now), now.id);
      return { plan: now, statusBefore: was.status, completedNow: completes, overpaidUgx: open ? Math.max(0, paid - was.totalUgx) : 0 };
    });
  }

  async markPaymentUnpaid(paymentId: string, status: 'failed' | 'abandoned' | 'review', providerStatus: string): Promise<boolean> {
    const rows = rowsOf(await db.execute(sql`
      update layby_payments set status = ${status}, provider_status = ${providerStatus.slice(0, 300)}, updated_at = now()
       where id = ${paymentId} and (status = 'awaiting_payment' or (${status} = 'review' and status in ('failed','abandoned'))) returning id`));
    return rows.length > 0;
  }

  async awaitingWithTransaction(olderThan: Date, newerThan: Date, limit: number): Promise<LaybyPaymentRecord[]> {
    return rowsOf(await db.execute(sql`
      select * from layby_payments where status = 'awaiting_payment' and order_tracking_id is not null
         and created_at < ${olderThan} and created_at > ${newerThan} order by created_at limit ${limit}`)).map(payment);
  }

  async awaitingStale(olderThan: Date, limit: number): Promise<LaybyPaymentRecord[]> {
    return rowsOf(await db.execute(sql`
      select * from layby_payments where status = 'awaiting_payment' and created_at < ${olderThan} order by created_at limit ${limit}`)).map(payment);
  }

  async activePlans(limit: number): Promise<LaybyPlanRecord[]> {
    return rowsOf(await db.execute(sql`select * from layby_plans where status = 'active' order by due_at limit ${limit}`)).map(plan);
  }

  async markReminderSent(planId: string, day: number, message: LaybyOutboxMessage): Promise<boolean> {
    return db.transaction(async (tx) => {
      const rows = rowsOf(await tx.execute(sql`
        update layby_plans set reminders_sent = array_append(reminders_sent, ${day}::int), updated_at = now()
         where id = ${planId} and status = 'active' and not (${day}::int = any(reminders_sent)) returning id`));
      if (rows.length === 0) return false;
      await enqueueInTx(tx, message, planId);
      return true;
    });
  }

  async close(planId: string, input: { status: 'lapsed' | 'cancelled'; feeUgx: number; refundUgx: number; reason: string; actorId: string | null; now: Date },
    message: ((plan: LaybyPlanRecord) => LaybyOutboxMessage) | null): Promise<LaybyPlanRecord | null> {
    return db.transaction(async (tx) => {
      const [r] = rowsOf(await tx.execute(sql`
        update layby_plans set status = ${input.status}, fee_ugx = ${input.feeUgx}, refund_ugx = ${input.refundUgx}, close_reason = ${input.reason},
               closed_by = ${input.actorId}, closed_at = ${input.now}, updated_at = now()
         where id = ${planId} and status in ('awaiting_deposit','active') returning *`));
      if (!r) return null;
      const closed = plan(r);
      if (message) await enqueueInTx(tx, message(closed), closed.id);
      return closed;
    });
  }
}
