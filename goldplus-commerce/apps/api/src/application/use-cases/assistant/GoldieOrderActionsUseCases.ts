import type { OpenTaskInput } from './CareDeskUseCases';

/**
 * Goldie acting on an order herself (owner, 2026-10-13: no person in the loop
 * for order changes and money; Goldie may still escalate).
 *
 * NOT WIRED YET: connecting this to the live order state machine and the
 * Pesapal refund ledger is the owner's switch (docs/assistant/README.md,
 * "Goldie order actions"). Until then request_order_change files a Care Desk
 * task. Every action, once wired:
 *  - proves the customer first (reference + checkout phone or email through the
 *    same verified lookup and 5-tries lockout as Track my order, or the
 *    Meta-verified WhatsApp number),
 *  - needs the customer's explicit yes in the conversation (checked by the
 *    caller against the customer's own last message, not the model's word),
 *  - follows the policy below in code, and
 *  - is recorded through the same machinery staff use (order state machine,
 *    refund ledger, audit), with Goldie named as the actor.
 *
 * Policy:
 *  - cancel: any order not yet with the rider (received, pending payment, being
 *    checked, being prepared, delivery failed). Paid online (Pesapal): refunded
 *    in full at once through the refund ledger, up to the cap. Paid another way
 *    (cash, direct Mobile Money): cancelled, and the refund is put on the Care
 *    Desk as urgent, because there is no provider to send it back through.
 *  - refund without cancelling: only for a delivery that failed, when the
 *    customer wants the money back instead of a new delivery (which is a cancel).
 *  - faulty or wrong items: a warranty check needs the item seen; Goldie logs it
 *    urgently and tells the customer the next step, never refunds unseen goods.
 *  - delivery instructions (time, landmark, a different phone for the rider):
 *    written on the order for the rider. A different area changes the fee, so it
 *    is a cancel and a new order, or the team.
 */
export interface VerifiedOrder {
  id: string; orderNumber: string; orderStatus: string; paymentStatus: string; totalUgx: number; customerName: string; customerPhone: string;
}

export interface GoldieOrderDeps {
  /** Same proof as Track my order. A verified WhatsApp number passes as the contact. */
  verify(reference: string, contact: string): Promise<{ ok: true; order: VerifiedOrder } | { ok: false; code: string; message: string; status: number }>;
  cancel(orderId: string, note: string, idempotencyKey: string): Promise<void>;
  /** Completed online payments for the order (merchantReference, amount). */
  completedPayments(orderId: string): Promise<Array<{ merchantReference: string; amount: number }>>;
  refund(input: { merchantReference: string; amountUgx: number; reason: string; idempotencyKey: string }): Promise<{ ok: true; refundId: string } | { ok: false; code: string; message: string }>;
  note(orderId: string, note: string): Promise<void>;
  openTask(input: OpenTaskInput): Promise<unknown>;
}

export type OrderActionResult = { ok: true; done: string; told: string; refunded?: number; escalated?: boolean } | { ok: false; code: string; told: string };

const CANCELLABLE = new Set(['received', 'pending_payment', 'pending_owner_review', 'processing', 'delivery_failed']);
const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString('en-GB')}`;

export class GoldieOrderActionsUseCases {
  constructor(private readonly deps: GoldieOrderDeps, private readonly config: { refundCapUgx: number }) {}

  private async proven(reference: string, contact: string): Promise<{ ok: true; order: VerifiedOrder } | { ok: false; result: OrderActionResult }> {
    const v = await this.deps.verify(reference, contact);
    if (v.ok) return v;
    const told = v.status === 429
      ? 'That order is locked for a few minutes after several tries, to keep it safe. Please try again shortly.'
      : "I couldn't match that order with that phone number or email. Please check both are exactly as used at checkout.";
    return { ok: false, result: { ok: false, code: v.code, told } };
  }

  async cancel(input: { reference: string; contact: string; reason: string; channel: string; conversationId: string | null }): Promise<OrderActionResult> {
    const p = await this.proven(input.reference, input.contact);
    if (!p.ok) return p.result;
    const o = p.order;
    const status = o.orderStatus.toLowerCase();
    if (status === 'cancelled') return { ok: true, done: 'already_cancelled', told: `Order ${o.orderNumber} is already cancelled.` };
    if (!CANCELLABLE.has(status)) {
      const where = status === 'dispatched' ? 'is already with the rider' : 'has already been delivered';
      return { ok: false, code: 'TOO_LATE', told: `Order ${o.orderNumber} ${where}, so it can't be cancelled from here. ${status === 'dispatched' ? 'You can decline it at the door, or I can get the team to call the rider now.' : 'If something is wrong with it, tell me and I will sort it out.'}` };
    }
    const reason = `Cancelled by the customer through Goldie (${input.channel}): ${input.reason}`.slice(0, 500);
    await this.deps.cancel(o.id, reason, `goldie-cancel:${o.id}`);
    if (o.paymentStatus !== 'paid') return { ok: true, done: 'cancelled', told: `Done. Order ${o.orderNumber} is cancelled, and nothing was charged.` };

    const refund = await this.refundAll(o, `Order ${o.orderNumber} cancelled by the customer before dispatch (Goldie). ${input.reason}`, input);
    return { ...refund, done: refund.ok ? `cancelled_${refund.done}` : 'cancelled', told: `Done. Order ${o.orderNumber} is cancelled. ${refund.told}` } as OrderActionResult;
  }

  /** Money back for a delivery that failed, when the customer does not want it delivered again (the order is cancelled with it). */
  async refundFailedDelivery(input: { reference: string; contact: string; reason: string; channel: string; conversationId: string | null }): Promise<OrderActionResult> {
    const p = await this.proven(input.reference, input.contact);
    if (!p.ok) return p.result;
    if (p.order.orderStatus.toLowerCase() !== 'delivery_failed') {
      return { ok: false, code: 'NOT_ELIGIBLE', told: 'I can refund straight away when an order is cancelled before the rider takes it, or when a delivery failed. For anything else, tell me what happened and I will sort it out the right way.' };
    }
    return this.cancel(input);
  }

  private async refundAll(o: VerifiedOrder, reason: string, ctx: { channel: string; conversationId: string | null }): Promise<OrderActionResult> {
    const payments = await this.deps.completedPayments(o.id);
    const owed = payments.reduce((s, p) => s + p.amount, 0);
    const escalate = async (why: string) => {
      await this.deps.openTask({ kind: 'urgent', title: `Refund ${ugx(owed || o.totalUgx)} for cancelled order ${o.orderNumber}: ${why}`, customerName: o.customerName, customerPhone: o.customerPhone, orderNumber: o.orderNumber, conversationId: ctx.conversationId, channel: ctx.channel, urgent: true });
      return { ok: true as const, done: 'refund_escalated', told: 'Your refund is with the team now, marked urgent; they will send it back the same way you paid and confirm with you.', escalated: true };
    };
    if (!payments.length) return escalate('paid outside online checkout (cash or direct Mobile Money)');
    if (owed > this.config.refundCapUgx) return escalate(`above Goldie's ${ugx(this.config.refundCapUgx)} limit`);
    let refunded = 0;
    for (const p of payments) {
      const r = await this.deps.refund({ merchantReference: p.merchantReference, amountUgx: p.amount, reason: reason.slice(0, 480), idempotencyKey: `goldie-refund:${o.id}:${p.merchantReference}` });
      if (!r.ok) return escalate(`the payment provider did not accept it (${r.code})`);
      refunded += p.amount;
    }
    return { ok: true, done: 'refunded', refunded, told: `I've sent ${ugx(refunded)} back to the account you paid from. The payment provider usually completes it within a few working days, and you will see it there.` };
  }

  /** Rider instructions written on the order: a time, a landmark, another phone for the rider. */
  async deliveryInstructions(input: { reference: string; contact: string; instructions: string; channel: string }): Promise<OrderActionResult> {
    const p = await this.proven(input.reference, input.contact);
    if (!p.ok) return p.result;
    const status = p.order.orderStatus.toLowerCase();
    if (['delivered', 'completed', 'cancelled'].includes(status)) return { ok: false, code: 'CLOSED', told: `Order ${p.order.orderNumber} is ${status === 'cancelled' ? 'cancelled' : 'already delivered'}, so there is nothing to change.` };
    const text = input.instructions.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (text.length < 4) return { ok: false, code: 'BAD_INPUT', told: 'What should the rider know: a better time, a landmark, or another number to call?' };
    await this.deps.note(p.order.id, `Customer via Goldie (${input.channel}): ${text}`);
    return { ok: true, done: 'noted', told: `Noted on order ${p.order.orderNumber} for the rider: "${text}".${status === 'dispatched' ? ' The rider already has the parcel, so please keep your phone on in case they call.' : ''}` };
  }
}
