import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYBY_CONFIG, checkInstalmentAmount, checkLaybySetting, isLaybyEligible, isLaybyPaymentReference, laybyConfigFrom, laybyDeposit,
  laybyPaymentReference, laybyRefund, remindersDue,
} from '../../apps/api/src/domain/layby/PayInParts';
import { PayInPartsUseCases } from '../../apps/api/src/application/use-cases/layby/PayInPartsUseCases';
import type { ILaybyOrderPort, ILaybyRepository, LaybyOutboxMessage, LaybyPaymentRecord, LaybyPlanRecord, LaybyOrderView } from '../../apps/api/src/application/ports/ILaybyRepository';
import { smsText, emailCopy, CUSTOMER_TRANSACTIONAL_TEMPLATES } from '../../apps/api/src/application/notifications/CustomerMessages';
import { classifyMessage } from '../../apps/api/src/infrastructure/notifications/messageClassification';

const DAY = 86_400_000;

describe('pay in parts: the owner rules (2026-11-07)', () => {
  it('defaults are the owner decisions, and stored settings override them only when valid', () => {
    expect(laybyConfigFrom({})).toEqual(DEFAULT_LAYBY_CONFIG);
    expect(DEFAULT_LAYBY_CONFIG).toMatchObject({ depositPercent: 30, termDays: 30, cancellationFeePercent: 10, minGoodsUgx: 100_000, reminderDays: [20, 27] });
    expect(laybyConfigFrom({ layby_deposit_percent: '40', layby_reminder_days: '25, 10' })).toMatchObject({ depositPercent: 40, reminderDays: [10, 25] });
    expect(laybyConfigFrom({ layby_deposit_percent: 'abc', layby_term_days: '0' })).toMatchObject({ depositPercent: 30, termDays: 30 });
    expect(checkLaybySetting('layby_reminder_days', '35', DEFAULT_LAYBY_CONFIG).ok).toBe(false);
    expect(checkLaybySetting('unknown', '1', DEFAULT_LAYBY_CONFIG).ok).toBe(false);
  });

  it('eligibility, deposit rounded up, refund = paid less 10% of paid', () => {
    expect(isLaybyEligible(99_999, DEFAULT_LAYBY_CONFIG)).toBe(false);
    expect(isLaybyEligible(100_000, DEFAULT_LAYBY_CONFIG)).toBe(true);
    expect(laybyDeposit(100_001, DEFAULT_LAYBY_CONFIG)).toBe(30_001);
    expect(laybyRefund(50_000, DEFAULT_LAYBY_CONFIG)).toEqual({ feeUgx: 5_000, refundUgx: 45_000 });
    expect(laybyRefund(0, DEFAULT_LAYBY_CONFIG)).toEqual({ feeUgx: 0, refundUgx: 0 });
  });

  it('an instalment is any whole amount up to the balance', () => {
    expect(checkInstalmentAmount('20,000', 70_000)).toEqual({ ok: true, amountUgx: 20_000 });
    expect(checkInstalmentAmount(70_001, 70_000).ok).toBe(false);
    expect(checkInstalmentAmount(0, 70_000).ok).toBe(false);
    expect(checkInstalmentAmount(500, 500)).toEqual({ ok: true, amountUgx: 500 });
  });

  it('reminders on day 20 and day 27, once each, only while something is owed', () => {
    const paidAt = new Date('2026-11-01T10:00:00Z');
    const at = (d: number) => new Date(paidAt.getTime() + d * DAY + 60_000);
    const base = { status: 'active' as const, depositPaidAt: paidAt, sentDays: [] as number[], balanceUgx: 10 };
    expect(remindersDue(base, DEFAULT_LAYBY_CONFIG, at(19))).toEqual([]);
    expect(remindersDue(base, DEFAULT_LAYBY_CONFIG, at(20))).toEqual([20]);
    expect(remindersDue({ ...base, sentDays: [20] }, DEFAULT_LAYBY_CONFIG, at(21))).toEqual([]);
    expect(remindersDue({ ...base, sentDays: [20] }, DEFAULT_LAYBY_CONFIG, at(27))).toEqual([27]);
    expect(remindersDue(base, DEFAULT_LAYBY_CONFIG, at(28))).toEqual([27]); // a missed day 20 is not sent late as well
    expect(remindersDue({ ...base, balanceUgx: 0 }, DEFAULT_LAYBY_CONFIG, at(20))).toEqual([]);
  });

  it('LB- references are their own, never an order number or a gift card', () => {
    const ref = laybyPaymentReference(Array.from({ length: 10 }, (_, i) => i * 3));
    expect(isLaybyPaymentReference(ref)).toBe(true);
    expect(isLaybyPaymentReference('GC-0123456789')).toBe(false);
    expect(isLaybyPaymentReference('GP-202611-ABCD')).toBe(false);
  });

  it('every pay-in-parts text is plain, short, transactional and names a way to pay or call', () => {
    const d = { customerName: 'Amina', orderNumber: 'GP-202611-AB12CD34', valueUgx: 30_000, balanceUgx: 70_000, spentUgx: 3_000, expiresAt: 'Monday 1 December', totalUgx: 100_000 };
    for (const t of ['LAYBY_PAYMENT_RECEIVED', 'LAYBY_REMINDER', 'LAYBY_LAPSED', 'LAYBY_CANCELLED']) {
      const s = smsText(t, d)!;
      expect(s, t).toBeTruthy();
      expect(s.length, t).toBeLessThanOrEqual(320);
      expect(s, t).toMatch(/0705 004545|https:\/\//);
      expect(s, t).not.toMatch(/[—–_]/);
      expect(emailCopy(t, d), t).toBeTruthy();
      expect(CUSTOMER_TRANSACTIONAL_TEMPLATES).toContain(t);
      expect(classifyMessage({ template: t, recipient: 'x', data: {} } as never)).toBe('TRANSACTIONAL');
    }
    expect(smsText('LAYBY_PAYMENT_RECEIVED', d)).toContain('/pay-in-parts?reference=GP-202611-AB12CD34');
    expect(smsText('LAYBY_PAYMENT_RECEIVED', { ...d, balanceUgx: 0 })).toMatch(/paid in full/);
  });
});

/* ------------------------------------------------------------------ */

class FakeRepo implements ILaybyRepository {
  settingsMap: Record<string, string> = {};
  plans: LaybyPlanRecord[] = [];
  payments: LaybyPaymentRecord[] = [];
  outbox: LaybyOutboxMessage[] = [];
  n = 0;
  async settings() { return { ...this.settingsMap }; }
  async saveSetting(k: string, v: string) { this.settingsMap[k] = v; }
  async planByOrderId(id: string) { return this.plans.find((p) => p.orderId === id) ?? null; }
  async planById(id: string) { return this.plans.find((p) => p.id === id) ?? null; }
  async createPlan(i: Parameters<ILaybyRepository['createPlan']>[0]) {
    const existing = await this.planByOrderId(i.orderId);
    if (existing) return existing;
    const p: LaybyPlanRecord = { ...i, id: `plan-${++this.n}`, paidUgx: 0, status: 'awaiting_deposit', depositPaidAt: null, dueAt: null, remindersSent: [], completedAt: null, closedAt: null, closeReason: null, feeUgx: null, refundUgx: null, createdAt: new Date() };
    this.plans.push(p);
    return p;
  }
  async list() { return this.plans; }
  async paymentsFor(planId: string) { return this.payments.filter((p) => p.planId === planId); }
  async createPayment(i: { planId: string; reference: string; kind: 'deposit' | 'instalment'; amountUgx: number }) {
    const p: LaybyPaymentRecord = { ...i, id: `pay-${++this.n}`, status: 'awaiting_payment', orderTrackingId: null, redirectUrl: null, confirmationCode: null, paymentMethod: null, createdAt: new Date(), paidAt: null };
    this.payments.push(p);
    return p;
  }
  async recordStarted(id: string, t: string, u: string) { const p = this.payments.find((x) => x.id === id)!; p.orderTrackingId = t; p.redirectUrl = u; }
  async paymentByTrackingId(t: string) { return this.payments.find((p) => p.orderTrackingId === t) ?? null; }
  async paymentByReference(r: string) { return this.payments.find((p) => p.reference === r) ?? null; }
  async openDeposit(planId: string, amount: number) { return this.payments.find((p) => p.planId === planId && p.kind === 'deposit' && p.amountUgx === amount && p.status === 'awaiting_payment' && p.redirectUrl) ?? null; }
  async markPaymentPaid(id: string, input: { confirmationCode: string | null; now: Date }, receipt: (p: LaybyPlanRecord) => LaybyOutboxMessage) {
    const pay = this.payments.find((x) => x.id === id)!;
    if (!['awaiting_payment', 'failed', 'abandoned'].includes(pay.status)) return null;
    pay.status = 'paid'; pay.paidAt = input.now; pay.confirmationCode = input.confirmationCode;
    const plan = this.plans.find((p) => p.id === pay.planId)!;
    const before = plan.status;
    const open = before === 'awaiting_deposit' || before === 'active';
    plan.paidUgx += pay.amountUgx;
    if (before === 'awaiting_deposit') { plan.status = 'active'; plan.depositPaidAt = input.now; plan.dueAt = new Date(input.now.getTime() + plan.termDays * DAY); }
    const completes = open && plan.paidUgx >= plan.totalUgx;
    if (completes) plan.status = 'paid';
    this.outbox.push(receipt(plan));
    return { plan: { ...plan }, statusBefore: before, completedNow: completes, overpaidUgx: open ? Math.max(0, plan.paidUgx - plan.totalUgx) : 0 };
  }
  async markPaymentUnpaid(id: string, status: 'failed' | 'abandoned' | 'review') { const p = this.payments.find((x) => x.id === id)!; if (p.status !== 'awaiting_payment') return false; p.status = status; return true; }
  async awaitingWithTransaction() { return []; }
  async awaitingStale() { return []; }
  async activePlans() { return this.plans.filter((p) => p.status === 'active'); }
  async markReminderSent(id: string, day: number, m: LaybyOutboxMessage) {
    const p = this.plans.find((x) => x.id === id)!;
    if (p.remindersSent.includes(day)) return false;
    p.remindersSent.push(day); this.outbox.push(m); return true;
  }
  async close(id: string, i: { status: 'lapsed' | 'cancelled'; feeUgx: number; refundUgx: number; reason: string; now: Date }, msg: ((p: LaybyPlanRecord) => LaybyOutboxMessage) | null) {
    const p = this.plans.find((x) => x.id === id)!;
    if (p.status !== 'active' && p.status !== 'awaiting_deposit') return null;
    Object.assign(p, { status: i.status, feeUgx: i.feeUgx, refundUgx: i.refundUgx, closeReason: i.reason, closedAt: i.now });
    if (msg) this.outbox.push(msg(p));
    return { ...p };
  }
}

function setup(order: Partial<LaybyOrderView> = {}) {
  const repo = new FakeRepo();
  const theOrder: LaybyOrderView = { id: 'o1', orderNumber: 'GP-1', customerName: 'Amina Nakato', customerPhone: '+256772123456', subtotalUgx: 150_000, totalUgx: 160_000, storeCreditAppliedUgx: 0, paymentStatus: 'unpaid', orderStatus: 'received', paymentMethod: 'pesapal', ...order };
  const calls = { settled: [] as string[], cancelled: [] as string[], tasks: [] as string[] };
  const orders: ILaybyOrderPort = {
    findById: async (id) => (id === theOrder.id ? theOrder : null),
    settlePaid: async (id) => { calls.settled.push(id); },
    cancel: async (id, reason) => { calls.cancelled.push(`${id}:${reason}`); },
    openTask: async (t) => { calls.tasks.push(t.title); },
  };
  const provider = new Map<string, { status_code: number; amount: number; merchant_reference: string }>();
  let tid = 0;
  const pesapal = {
    submitOrderRequest: async (r: { id: string; amount: number }) => { const t = `T${++tid}`; provider.set(t, { status_code: 0, amount: r.amount, merchant_reference: r.id }); return { order_tracking_id: t, redirect_url: `https://pay/${t}` }; },
    getTransactionStatus: async (t: string) => { const p = provider.get(t)!; return { ...p, currency: 'UGX', payment_status_description: p.status_code === 1 ? 'Completed' : 'Pending', confirmation_code: 'C1', payment_method: 'MTN' }; },
  } as never;
  let seed = 0;
  const uc = new PayInPartsUseCases(repo, orders, pesapal, { randomIndexes: () => Array.from({ length: 10 }, () => (seed++ * 7) % 32) },
    () => ({ ipnId: 'ipn', callbackUrl: 'https://api/cb', resultPageUrl: 'https://shop/pay-in-parts' }));
  const pay = (trackingId: string) => { provider.get(trackingId)!.status_code = 1; };
  return { repo, uc, calls, pay, provider };
}

describe('pay in parts: the plan, end to end on fakes', () => {
  it('deposit is 30% of the total, opened under an LB- reference; the order is NOT paid until the balance is in', async () => {
    const { repo, uc, calls, pay } = setup();
    const start = await uc.startDeposit('o1');
    expect(start).toMatchObject({ ok: true });
    if (!start.ok) return;
    expect(isLaybyPaymentReference(start.reference)).toBe(true);
    expect(repo.payments[0].amountUgx).toBe(48_000);
    // Same deposit page reused, never a second one.
    const again = await uc.startDeposit('o1');
    expect(again.ok && again.reference).toBe(start.reference);

    pay('T1');
    await uc.settle({ trackingId: 'T1', reference: start.reference, source: 'ipn' });
    await uc.settle({ trackingId: 'T1', reference: start.reference, source: 'ipn' }); // replayed IPN: counted once
    expect(repo.plans[0]).toMatchObject({ status: 'active', paidUgx: 48_000 });
    expect(repo.plans[0].dueAt!.getTime() - repo.plans[0].depositPaidAt!.getTime()).toBe(30 * DAY);
    expect(calls.settled).toEqual([]);
    expect(repo.outbox.filter((m) => m.template === 'LAYBY_PAYMENT_RECEIVED')).toHaveLength(1);
    expect(await uc.blocksFullPayment('o1')).toBe(true);

    const inst = await uc.startInstalment('o1', 200_000);
    expect(inst.ok).toBe(false); // more than the balance
    const rest = await uc.startInstalment('o1', 112_000);
    expect(rest.ok).toBe(true);
    pay('T2');
    await uc.settle({ trackingId: 'T2', reference: rest.ok ? rest.reference : '', source: 'callback' });
    expect(repo.plans[0].status).toBe('paid');
    expect(calls.settled).toEqual(['o1']);
  });

  it('refuses orders under the minimum, gift-card orders and pay-on-delivery orders', async () => {
    expect((await setup({ subtotalUgx: 99_000 }).uc.startDeposit('o1')).ok).toBe(false);
    expect((await setup({ storeCreditAppliedUgx: 10_000 }).uc.startDeposit('o1')).ok).toBe(false);
    expect((await setup({ paymentMethod: 'offline' }).uc.startDeposit('o1')).ok).toBe(false);
    expect((await setup({ paymentStatus: 'paid' }).uc.startDeposit('o1')).ok).toBe(false);
  });

  it('staff cancel: refund = paid less 10%, order cancelled, Care Desk task opened, customer texted', async () => {
    const { repo, uc, calls, pay } = setup();
    const s = await uc.startDeposit('o1');
    pay('T1');
    await uc.settle({ trackingId: 'T1', reference: s.ok ? s.reference : '', source: 'ipn' });
    expect((await uc.cancel(repo.plans[0].id, 'staff', 'x')).ok).toBe(false); // a reason is required
    const r = await uc.cancel(repo.plans[0].id, 'staff', 'Customer asked to cancel');
    expect(r.ok).toBe(true);
    expect(repo.plans[0]).toMatchObject({ status: 'cancelled', feeUgx: 4_800, refundUgx: 43_200 });
    expect(calls.cancelled).toEqual(['o1:layby_cancelled']);
    expect(calls.tasks[0]).toMatch(/refund: send UGX 43,200/);
    expect(repo.outbox.at(-1)?.template).toBe('LAYBY_CANCELLED');
  });

  it('sweep: reminders on day 20 and 27, then the plan lapses after 30 days with the refund recorded', async () => {
    const { repo, uc, calls, pay } = setup();
    const s = await uc.startDeposit('o1');
    pay('T1');
    const t0 = new Date('2026-11-07T08:00:00Z');
    await uc.settle({ trackingId: 'T1', reference: s.ok ? s.reference : '', source: 'ipn' }, t0);
    const at = (d: number) => new Date(t0.getTime() + d * DAY + 60_000);
    expect((await uc.sweep(at(10))).reminded).toBe(0);
    expect((await uc.sweep(at(20))).reminded).toBe(1);
    expect((await uc.sweep(at(20))).reminded).toBe(0);
    expect((await uc.sweep(at(27))).reminded).toBe(1);
    expect((await uc.sweep(at(30))).lapsed).toBe(1);
    expect(repo.plans[0]).toMatchObject({ status: 'lapsed', refundUgx: 43_200 });
    expect(calls.cancelled).toEqual(['o1:layby_lapsed']);
    expect(repo.outbox.map((m) => m.template)).toEqual(['LAYBY_PAYMENT_RECEIVED', 'LAYBY_REMINDER', 'LAYBY_REMINDER', 'LAYBY_LAPSED']);
  });

  it('money that lands after a plan closed is recorded and handed to a person for a full refund', async () => {
    const { repo, uc, calls, pay } = setup();
    const s = await uc.startDeposit('o1');
    pay('T1');
    await uc.settle({ trackingId: 'T1', reference: s.ok ? s.reference : '', source: 'ipn' });
    const inst = await uc.startInstalment('o1', 10_000);
    await uc.cancel(repo.plans[0].id, 'staff', 'Customer asked to cancel');
    pay('T2');
    await uc.settle({ trackingId: 'T2', reference: inst.ok ? inst.reference : '', source: 'ipn' });
    expect(calls.tasks.some((t) => /paid after the plan closed/.test(t))).toBe(true);
    expect(calls.settled).toEqual([]);
  });

  it('a provider answer that disagrees with the record is parked for review, never counted', async () => {
    const { repo, uc, provider } = setup();
    const s = await uc.startDeposit('o1');
    provider.set('T1', { status_code: 1, amount: 1, merchant_reference: s.ok ? s.reference : '' });
    await uc.settle({ trackingId: 'T1', reference: s.ok ? s.reference : '', source: 'ipn' });
    expect(repo.payments[0].status).toBe('review');
    expect(repo.plans[0].paidUgx).toBe(0);
  });
});
