import type { IPesaPalClient } from '../../ports/IPesaPalClient';
import type { ILaybyOrderPort, ILaybyRepository, LaybyOrderView, LaybyOutboxMessage, LaybyPaymentRecord, LaybyPlanRecord } from '../../ports/ILaybyRepository';
import {
  LAYBY_CONFIG_REGISTRY, checkInstalmentAmount, checkLaybySetting, isLaybyEligible, isLaybyPaymentReference, kampalaDayWords,
  laybyConfigFrom, laybyDeposit, laybyPaymentReference, laybyRefund, remindersDue, type LaybyConfig, type LaybyPlanStatus,
} from '../../../domain/layby/PayInParts';

/**
 * Pay in parts (lay-by), owner rules 2026-11-07, migration 0222.
 *
 * start:  the deposit (from checkout) or a later payment (from the pay-in-parts page) opens a Pesapal page under the
 *         payment's own LB- reference, never the order number, so nothing here can mark the order paid early.
 * settle: whichever door the news comes through (return leg, IPN, poller), ask Pesapal and believe only its answer;
 *         the payment is counted once (compare-and-set). When the plan is paid in full the ORDER is settled through
 *         the same doors as an order paid by gift card, and only then is it prepared, delivered or collected.
 * sweep:  ask about payments nobody reported, close abandoned pages, text the reminders, lapse plans past their date.
 * cancel: staff, when the customer asks. Cancel and lapse record refund = paid less the fee; a person sends it.
 */

export interface LaybyPaymentConfig {
  ipnId: string | null;
  callbackUrl: string;
  /** Storefront page that shows a payment's outcome and the plan: …/pay-in-parts */
  resultPageUrl: string;
}

export type StartLaybyResult =
  | { ok: true; reference: string; redirectUrl: string }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_ELIGIBLE' | 'INVALID' | 'CLOSED' | 'NOT_CONFIGURED' | 'PROVIDER'; message: string };

export interface LaybyPublicView {
  orderNumber: string;
  status: LaybyPlanStatus;
  totalUgx: number;
  depositUgx: number;
  paidUgx: number;
  balanceUgx: number;
  dueAt: string | null;
  feePercent: number;
  refundUgx: number | null;
  payments: Array<{ amountUgx: number; status: string; paidAt: string | null; kind: string }>;
}

const UNPAID_GRACE_MS = 24 * 3_600_000;
const CLOSED_ORDER = new Set(['cancelled', 'failed', 'delivered', 'completed', 'dispatched']);
const ugx = (n: number) => `UGX ${Math.max(0, Math.round(n)).toLocaleString('en-US')}`;

export class PayInPartsUseCases {
  private readonly lastAsked = new Map<string, number>();
  constructor(
    private readonly repo: ILaybyRepository,
    private readonly orders: ILaybyOrderPort,
    private readonly pesapal: IPesaPalClient,
    private readonly tools: { randomIndexes(): number[] },
    private readonly config: () => LaybyPaymentConfig,
    private readonly log: (event: string, detail: Record<string, unknown>) => void = () => undefined,
  ) {}

  async terms(): Promise<LaybyConfig> {
    return laybyConfigFrom(await this.repo.settings());
  }

  /** What checkout shows before the order exists: whether this basket may be paid in parts, and the deposit. */
  async quote(goodsUgx: number, totalUgx: number): Promise<{ eligible: boolean; depositUgx: number; terms: LaybyConfig }> {
    const terms = await this.terms();
    const eligible = isLaybyEligible(goodsUgx, terms) && totalUgx > 0;
    return { eligible, depositUgx: eligible ? laybyDeposit(totalUgx, terms) : 0, terms };
  }

  /** Settings for the admin page: each key with its value now. */
  async settings(): Promise<{ config: LaybyConfig; entries: Array<{ key: string; label: string; help: string; value: string }> }> {
    const values = await this.repo.settings();
    const config = laybyConfigFrom(values);
    const shown: Record<string, string> = {
      layby_deposit_percent: String(config.depositPercent), layby_term_days: String(config.termDays),
      layby_cancellation_fee_percent: String(config.cancellationFeePercent), layby_min_goods_ugx: String(config.minGoodsUgx),
      layby_reminder_days: config.reminderDays.join(','),
    };
    return { config, entries: LAYBY_CONFIG_REGISTRY.map((e) => ({ key: e.key, label: e.label, help: e.help, value: shown[e.key] })) };
  }

  /** A new setting applies to plans started afterwards; a running plan keeps the deposit, term and fee it started with. */
  async saveSetting(key: string, raw: unknown, actorId: string): Promise<{ ok: true; value: string } | { ok: false; message: string }> {
    const checked = checkLaybySetting(key, raw, await this.terms());
    if (!checked.ok) return checked;
    await this.repo.saveSetting(key, checked.value, actorId);
    return checked;
  }

  /** The deposit, for an order checkout just created (the caller has proved the order is theirs). */
  async startDeposit(orderId: string): Promise<StartLaybyResult> {
    const order = await this.orders.findById(orderId);
    if (!order) return { ok: false, code: 'NOT_FOUND', message: 'We could not find that order.' };
    const terms = await this.terms();
    const refusal = this.orderRefusal(order, terms);
    if (refusal) return refusal;
    let plan = await this.repo.planByOrderId(order.id);
    if (!plan) {
      plan = await this.repo.createPlan({
        orderId: order.id, orderNumber: order.orderNumber, customerName: order.customerName, customerPhone: order.customerPhone,
        totalUgx: order.totalUgx, depositUgx: laybyDeposit(order.totalUgx, terms),
        depositPercent: terms.depositPercent, termDays: terms.termDays, feePercent: terms.cancellationFeePercent,
      });
    }
    if (plan.status !== 'awaiting_deposit') {
      return plan.status === 'active'
        ? { ok: false, code: 'CLOSED', message: 'The deposit for this order is already paid. Pay the rest from the pay in parts page.' }
        : { ok: false, code: 'CLOSED', message: 'This plan is closed. Call us and we will help.' };
    }
    // A deposit page opened in the last half hour is reused: one order, one deposit page at a time.
    const open = await this.repo.openDeposit(plan.id, plan.depositUgx, new Date(Date.now() - 30 * 60_000));
    if (open?.redirectUrl) return { ok: true, reference: open.reference, redirectUrl: open.redirectUrl };
    return this.openPage(plan, order, 'deposit', plan.depositUgx);
  }

  /** A later payment: any amount up to the balance (the caller proved the order with its number and phone). */
  async startInstalment(orderId: string, amount: unknown): Promise<StartLaybyResult> {
    const plan = await this.repo.planByOrderId(orderId);
    const order = plan ? await this.orders.findById(orderId) : null;
    if (!plan || !order) return { ok: false, code: 'NOT_FOUND', message: 'This order is not being paid in parts.' };
    if (plan.status === 'awaiting_deposit') return this.startDeposit(orderId);
    if (plan.status !== 'active') return { ok: false, code: 'CLOSED', message: plan.status === 'paid' ? 'This order is fully paid. There is nothing more to pay.' : 'This plan is closed, so it cannot take payments. Call us and we will help.' };
    const checked = checkInstalmentAmount(amount, plan.totalUgx - plan.paidUgx);
    if (!checked.ok) return { ok: false, code: 'INVALID', message: checked.message };
    return this.openPage(plan, order, 'instalment', checked.amountUgx);
  }

  private orderRefusal(order: LaybyOrderView, terms: LaybyConfig): StartLaybyResult | null {
    if (order.paymentStatus === 'paid') return { ok: false, code: 'CLOSED', message: 'This order is already paid.' };
    if (CLOSED_ORDER.has(order.orderStatus)) return { ok: false, code: 'CLOSED', message: 'This order is closed, so it cannot be paid in parts.' };
    if (order.paymentMethod !== 'pesapal') return { ok: false, code: 'NOT_ELIGIBLE', message: 'Only orders paid online can be paid in parts.' };
    if (order.storeCreditAppliedUgx > 0) return { ok: false, code: 'NOT_ELIGIBLE', message: 'An order paid partly with a gift card cannot also be paid in parts.' };
    if (!isLaybyEligible(order.subtotalUgx, terms)) {
      return { ok: false, code: 'NOT_ELIGIBLE', message: `Pay in parts is for orders of ${ugx(terms.minGoodsUgx)} or more.` };
    }
    return null;
  }

  private async openPage(plan: LaybyPlanRecord, order: LaybyOrderView, kind: 'deposit' | 'instalment', amountUgx: number): Promise<StartLaybyResult> {
    const cfg = this.config();
    if (!cfg.ipnId) return { ok: false, code: 'NOT_CONFIGURED', message: 'Paying online is not available right now. Call us and we will help.' };
    let payment: LaybyPaymentRecord | null = null;
    for (let attempt = 0; attempt < 3 && !payment; attempt++) {
      try {
        payment = await this.repo.createPayment({ planId: plan.id, reference: laybyPaymentReference(this.tools.randomIndexes()), kind, amountUgx });
      } catch (err) {
        if (!/layby_payments_reference_uq|duplicate key/i.test(String((err as Error)?.message ?? err))) throw err;
      }
    }
    if (!payment) throw new Error('LAYBY_REFERENCE_COLLISION');
    const [first, ...rest] = String(order.customerName ?? '').trim().split(/\s+/);
    try {
      const page = await this.pesapal.submitOrderRequest({
        id: payment.reference,
        currency: 'UGX',
        amount: amountUgx,
        description: `GoldPlus order ${order.orderNumber}, ${kind === 'deposit' ? 'deposit' : 'part payment'}`,
        callback_url: cfg.callbackUrl,
        cancellation_url: `${cfg.resultPageUrl}?ref=${encodeURIComponent(payment.reference)}&cancelled=1`,
        notification_id: cfg.ipnId,
        billing_address: { email_address: 'billing@goldplus-uganda.com', phone_number: order.customerPhone, first_name: first || 'Customer', last_name: rest.join(' ') || 'GoldPlus' },
      });
      await this.repo.recordStarted(payment.id, page.order_tracking_id, page.redirect_url);
      return { ok: true, reference: payment.reference, redirectUrl: page.redirect_url };
    } catch (err) {
      this.log('layby_payment_start_failed', { reference: payment.reference, error: String((err as Error)?.message ?? err) });
      return { ok: false, code: 'PROVIDER', message: 'We could not open the payment page just now. Nothing was charged. Please try again in a minute.' };
    }
  }

  /** Learn a payment's outcome from Pesapal (idempotent: a payment is counted once, however often this is asked). */
  async settle(input: { trackingId: string; reference: string; source: 'callback' | 'ipn' | 'poll' }, now = new Date()): Promise<LaybyPaymentRecord | null> {
    const trackingId = input.trackingId.trim();
    const p = trackingId ? await this.repo.paymentByTrackingId(trackingId) : null;
    if (!p || p.reference !== input.reference.trim()) return null;
    const lateNews = (p.status === 'failed' || p.status === 'abandoned') && input.source !== 'poll';
    if (p.status !== 'awaiting_payment' && !lateNews) return p;

    let s;
    try {
      s = await this.pesapal.getTransactionStatus(trackingId, input.source === 'poll' ? { breakerName: 'pesapal-layby-poll' } : undefined);
    } catch (err) {
      this.log('layby_status_failed', { reference: p.reference, source: input.source, error: String((err as Error)?.message ?? err) });
      return p;
    }
    const providerStatus = `${s.status_code} ${String(s.payment_status_description ?? '').slice(0, 80)}`.trim();
    if (lateNews && s.status_code !== 1) return p;
    if (s.merchant_reference !== p.reference || Number(s.amount) !== p.amountUgx || String(s.currency).toUpperCase() !== 'UGX') {
      await this.repo.markPaymentUnpaid(p.id, 'review', `MISMATCH ${s.merchant_reference} ${s.amount} ${s.currency} (${providerStatus})`);
      this.log('layby_payment_mismatch', { reference: p.reference });
      return this.repo.paymentByReference(p.reference);
    }
    if (s.status_code === 1) {
      const outcome = await this.repo.markPaymentPaid(
        p.id,
        { confirmationCode: s.confirmation_code ?? null, paymentMethod: s.payment_method ?? null, providerStatus, now },
        (plan) => this.receipt(plan, p),
      );
      if (outcome) await this.afterPaid(outcome, p);
      return this.repo.paymentByReference(p.reference);
    }
    if (s.status_code === 0 && /^(invalid|pending)?$/i.test(String(s.payment_status_description ?? '').trim()) && now.getTime() - p.createdAt.getTime() < UNPAID_GRACE_MS) {
      return p;
    }
    await this.repo.markPaymentUnpaid(p.id, 'failed', providerStatus);
    return this.repo.paymentByReference(p.reference);
  }

  private async afterPaid(outcome: NonNullable<Awaited<ReturnType<ILaybyRepository['markPaymentPaid']>>>, p: LaybyPaymentRecord): Promise<void> {
    const plan = outcome.plan;
    const who = { orderNumber: plan.orderNumber, customerName: plan.customerName, customerPhone: plan.customerPhone };
    if (outcome.statusBefore === 'lapsed' || outcome.statusBefore === 'cancelled') {
      // Money is real even when it arrives after the plan closed: a person refunds it in full.
      await this.task({ ...who, urgent: true, title: `Pay in parts: ${ugx(p.amountUgx)} paid after the plan closed (${plan.orderNumber})`,
        detail: `Payment ${p.reference} of ${ugx(p.amountUgx)} arrived after this plan was ${outcome.statusBefore}. Refund it in full from the Pesapal dashboard (confirmation ${p.confirmationCode ?? 'see Pesapal'}), and tell the customer.` });
      return;
    }
    if (outcome.overpaidUgx > 0) {
      await this.task({ ...who, urgent: true, title: `Pay in parts: ${ugx(outcome.overpaidUgx)} paid too much (${plan.orderNumber})`,
        detail: `Two payments landed together and the customer paid ${ugx(outcome.overpaidUgx)} more than the order total. Refund the difference from the Pesapal dashboard.` });
    }
    if (outcome.completedNow) {
      // Paid in full: now, and only now, the order is paid and goes to be prepared.
      await this.orders.settlePaid(plan.orderId, `layby:${plan.id}`).catch((err) => {
        this.log('layby_order_settle_failed', { orderNumber: plan.orderNumber, error: String((err as Error)?.message ?? err) });
        return this.task({ ...who, urgent: true, title: `Pay in parts: ${plan.orderNumber} is paid in full but the order did not move`,
          detail: 'Every part is paid. Mark the order paid and send it to be prepared.' });
      });
    }
  }

  private async task(input: Parameters<ILaybyOrderPort['openTask']>[0]): Promise<void> {
    await this.orders.openTask(input).catch((err) => this.log('layby_task_failed', { orderNumber: input.orderNumber, error: String((err as Error)?.message ?? err) }));
  }

  private receipt(plan: LaybyPlanRecord, p: LaybyPaymentRecord): LaybyOutboxMessage {
    const balance = Math.max(0, plan.totalUgx - plan.paidUgx);
    return {
      template: 'LAYBY_PAYMENT_RECEIVED', phone: plan.customerPhone, idempotencyKey: `layby-paid:${p.id}`,
      data: { customerName: plan.customerName, orderNumber: plan.orderNumber, valueUgx: p.amountUgx, balanceUgx: balance, totalUgx: plan.totalUgx,
        expiresAt: plan.dueAt ? kampalaDayWords(plan.dueAt) : null },
    };
  }

  /** The plan for the pay-in-parts page (the caller proved the order). Asks Pesapal about a page still open. */
  async view(orderId: string, now = new Date()): Promise<LaybyPublicView | null> {
    let plan = await this.repo.planByOrderId(orderId);
    if (!plan) return null;
    let payments = await this.repo.paymentsFor(plan.id);
    const open = payments.filter((x) => x.status === 'awaiting_payment' && x.orderTrackingId && (this.lastAsked.get(x.reference) ?? 0) < now.getTime() - 15_000);
    if (open.length) {
      for (const x of open.slice(0, 3)) {
        this.lastAsked.set(x.reference, now.getTime());
        await this.settle({ trackingId: x.orderTrackingId!, reference: x.reference, source: 'callback' }, now).catch(() => null);
      }
      if (this.lastAsked.size > 5_000) this.lastAsked.clear();
      plan = (await this.repo.planByOrderId(orderId)) ?? plan;
      payments = await this.repo.paymentsFor(plan.id);
    }
    return {
      orderNumber: plan.orderNumber, status: plan.status, totalUgx: plan.totalUgx, depositUgx: plan.depositUgx, paidUgx: plan.paidUgx,
      balanceUgx: Math.max(0, plan.totalUgx - plan.paidUgx), dueAt: plan.dueAt?.toISOString() ?? null, feePercent: plan.feePercent,
      refundUgx: plan.refundUgx,
      payments: payments.filter((x) => x.status === 'paid' || x.status === 'review')
        .map((x) => ({ amountUgx: x.amountUgx, status: x.status, paidAt: x.paidAt?.toISOString() ?? null, kind: x.kind })),
    };
  }

  /** The outcome page after Pesapal (the LB- reference is unguessable and shows only amounts). */
  async paymentStatus(reference: unknown): Promise<{ reference: string; status: string; amountUgx: number; orderNumber: string; balanceUgx: number; planStatus: LaybyPlanStatus } | null> {
    if (!isLaybyPaymentReference(reference)) return null;
    let p = await this.repo.paymentByReference(reference);
    if (!p) return null;
    if (p.status === 'awaiting_payment' && p.orderTrackingId && (this.lastAsked.get(p.reference) ?? 0) < Date.now() - 15_000) {
      this.lastAsked.set(p.reference, Date.now());
      p = (await this.settle({ trackingId: p.orderTrackingId, reference: p.reference, source: 'callback' })) ?? p;
    }
    const plan = await this.repo.planById(p.planId);
    if (!plan) return null;
    return { reference: p.reference, status: p.status === 'abandoned' ? 'failed' : p.status, amountUgx: p.amountUgx, orderNumber: plan.orderNumber, balanceUgx: Math.max(0, plan.totalUgx - plan.paidUgx), planStatus: plan.status };
  }

  /** A plan with money in (or paid) owns the order's payments: the full-price page must not open for it. */
  async blocksFullPayment(orderId: string): Promise<boolean> {
    const plan = await this.repo.planByOrderId(orderId);
    return Boolean(plan && (plan.status === 'active' || plan.status === 'paid'));
  }

  list(status: LaybyPlanStatus | null) { return this.repo.list({ status, limit: 200 }); }

  /**
   * Staff cancel, when the customer asks (or the shop must). Refund = paid less the fee; a Care Desk task carries the
   * refund for a person to send. The order is cancelled and its stock goes back on sale.
   */
  async cancel(planId: string, actorId: string, reason: string, now = new Date()): Promise<{ ok: boolean; message: string; plan?: LaybyPlanRecord }> {
    if (reason.trim().length < 5) return { ok: false, message: 'Say why the plan is cancelled.' };
    return this.closePlan(planId, 'cancelled', reason.trim(), actorId, now);
  }

  private async closePlan(planId: string, status: 'lapsed' | 'cancelled', reason: string, actorId: string | null, now: Date): Promise<{ ok: boolean; message: string; plan?: LaybyPlanRecord }> {
    const before = await this.repo.planById(planId);
    if (!before || (before.status !== 'active' && before.status !== 'awaiting_deposit')) return { ok: false, message: 'Only an open plan can be closed.' };
    const { feeUgx, refundUgx } = laybyRefund(before.paidUgx, { cancellationFeePercent: before.feePercent });
    const plan = await this.repo.close(planId, { status, feeUgx, refundUgx, reason: reason.slice(0, 500), actorId, now },
      before.paidUgx > 0 ? (p) => ({
        template: status === 'lapsed' ? 'LAYBY_LAPSED' : 'LAYBY_CANCELLED', phone: p.customerPhone, idempotencyKey: `layby-${status}:${p.id}`,
        data: { customerName: p.customerName, orderNumber: p.orderNumber, valueUgx: p.paidUgx, balanceUgx: refundUgx, spentUgx: feeUgx },
      }) : null);
    if (!plan) return { ok: false, message: 'This plan changed a moment ago. Open it again.' };
    await this.orders.cancel(plan.orderId, status === 'lapsed' ? 'layby_lapsed' : 'layby_cancelled',
      status === 'lapsed' ? `Pay in parts: balance not paid within ${plan.termDays} days.` : `Pay in parts cancelled: ${reason}`).catch((err) =>
      this.log('layby_order_cancel_failed', { orderNumber: plan.orderNumber, error: String((err as Error)?.message ?? err) }));
    if (plan.paidUgx > 0) {
      await this.task({ orderNumber: plan.orderNumber, customerName: plan.customerName, customerPhone: plan.customerPhone, urgent: false,
        title: `Pay in parts refund: send ${ugx(refundUgx)} for ${plan.orderNumber}`,
        detail: `The plan was ${status}${status === 'cancelled' ? ` (${reason})` : ''}. The customer paid ${ugx(plan.paidUgx)}; the fee is ${plan.feePercent}% of that (${ugx(feeUgx)}). Refund ${ugx(refundUgx)} by hand and note how it was sent.` });
    }
    return { ok: true, message: plan.paidUgx > 0 ? `Plan ${status}. Refund ${ugx(refundUgx)} (paid ${ugx(plan.paidUgx)} less ${ugx(feeUgx)}); a Care Desk task was opened for it.` : `Plan ${status}. Nothing was paid, so nothing is owed.`, plan };
  }

  /** The poller: unreported payments, abandoned pages, reminders, lapses. Every write is a compare-and-set. */
  async sweep(now = new Date()): Promise<{ polled: number; abandoned: number; reminded: number; lapsed: number }> {
    let polled = 0, abandoned = 0, reminded = 0, lapsed = 0;
    for (const p of await this.repo.awaitingWithTransaction(new Date(now.getTime() - 10 * 60_000), new Date(now.getTime() - 7 * 86_400_000), 50)) {
      polled += 1;
      await this.settle({ trackingId: p.orderTrackingId!, reference: p.reference, source: 'poll' }, now).catch((err) => this.log('layby_poll_failed', { reference: p.reference, error: String(err) }));
    }
    for (const p of await this.repo.awaitingStale(new Date(now.getTime() - UNPAID_GRACE_MS), 100)) {
      const giveUp = !p.orderTrackingId || p.createdAt.getTime() < now.getTime() - 7 * 86_400_000;
      if (giveUp && (await this.repo.markPaymentUnpaid(p.id, 'abandoned', p.orderTrackingId ? 'NO_PAYMENT_AFTER_7_DAYS' : 'PAYMENT_PAGE_NEVER_OPENED'))) abandoned += 1;
    }
    const terms = await this.terms();
    for (const plan of await this.repo.activePlans(500)) {
      const balance = plan.totalUgx - plan.paidUgx;
      if (plan.dueAt && plan.dueAt.getTime() <= now.getTime() && balance > 0) {
        const r = await this.closePlan(plan.id, 'lapsed', `Balance of ${ugx(balance)} not paid by ${kampalaDayWords(plan.dueAt)}.`, null, now).catch(() => ({ ok: false }));
        if (r.ok) lapsed += 1;
        continue;
      }
      for (const day of remindersDue({ status: plan.status, depositPaidAt: plan.depositPaidAt, sentDays: plan.remindersSent, balanceUgx: balance }, terms, now)) {
        const sent = await this.repo.markReminderSent(plan.id, day, {
          template: 'LAYBY_REMINDER', phone: plan.customerPhone, idempotencyKey: `layby-reminder:${plan.id}:${day}`,
          data: { customerName: plan.customerName, orderNumber: plan.orderNumber, balanceUgx: balance, expiresAt: plan.dueAt ? kampalaDayWords(plan.dueAt) : null },
        });
        if (sent) reminded += 1;
      }
    }
    return { polled, abandoned, reminded, lapsed };
  }
}
