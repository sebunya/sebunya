import type { IOrderTransitionPort } from '../../ports/IOrderTransitionPort';

/**
 * An order whose whole amount is paid by store credit / a gift card (gap analysis #17). There is nothing to send
 * to Pesapal, so it is settled here through the SAME doors a verified Pesapal payment uses: the canonical
 * transition to processing with paymentStatus 'paid' (which also appends order_confirmed for measurement), the
 * checkout reconciliation that advances the saga to ORDER_CONFIRMED and records its side-effect events, then the
 * confirmed-payment effects (fulfilment, loyalty, credit capture, admin email, alert, customer receipt).
 *
 * Only when the order really owes nothing: total > 0, credit = total, not already paid. Idempotent: the
 * transition key and the reconcile stage guard make a second call a no-op.
 */
export interface CreditSettlementOrderReader {
  findById(orderId: string): Promise<{ id: string; totalUgx: number; storeCreditAppliedUgx?: number; paymentStatus: string; orderStatus: string } | null>;
}

export class SettleByStoreCreditUseCase {
  constructor(
    private readonly orders: CreditSettlementOrderReader,
    private readonly transition: Pick<IOrderTransitionPort, 'transition'>,
    private readonly reconcile: { execute(input: { verification: { ok: boolean; orderId: string; status: string; lifecycleConflict?: boolean; superseded?: boolean }; traceId: string }): Promise<{ kind: string }> },
    private readonly effects: { runCreditPaidEffects(orderId: string): Promise<void> },
  ) {}

  async execute(orderId: string, traceId: string): Promise<'settled' | 'not_fully_covered' | 'already_paid' | 'not_found'> {
    const order = await this.orders.findById(orderId);
    if (!order) return 'not_found';
    if (order.paymentStatus === 'paid') return 'already_paid';
    const credit = order.storeCreditAppliedUgx ?? 0;
    if (order.totalUgx <= 0 || credit < order.totalUgx) return 'not_fully_covered';

    // The payment actor, deliberately: credit is money received, and an order held for owner review must behave
    // exactly as a Pesapal payment does there (the money is recorded, the move to processing stays the owner's).
    await this.transition.transition(orderId, 'processing', {
      actorType: 'payment_provider',
      source: 'payment',
      reasonCode: 'paid_by_store_credit',
      paymentStatus: 'paid',
      idempotencyKey: `store-credit:paid:${orderId}`,
      correlationId: orderId,
    });
    await this.reconcile.execute({ verification: { ok: true, orderId, status: 'paid', lifecycleConflict: false, superseded: false }, traceId });
    await this.effects.runCreditPaidEffects(orderId);
    return 'settled';
  }
}
