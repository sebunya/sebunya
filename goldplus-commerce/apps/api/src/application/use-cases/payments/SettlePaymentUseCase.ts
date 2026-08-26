import {
  PaymentSettlementOutcome,
  ReconcileOrderPaymentUseCase,
  paymentDidConfirm,
} from '../commerce/ReconcileOrderPaymentUseCase';
import { VerifyPesaPalPaymentOutput, VerifyPesaPalPaymentUseCase } from './VerifyPesaPalPaymentUseCase';

/**
 * THE payment settlement path (payments brief, 2026-08-06).
 *
 * Four things can learn a payment's fate: the browser callback, the provider's
 * IPN, the reconciliation poller, and an operator pressing re-verify. Before
 * this file the first two each carried their own ~90-line copy of the
 * post-confirmation effects, and the second two did not exist — which is
 * exactly how five attempts sat in `pending` from May to August with nobody
 * asking the provider what had happened.
 *
 * Now there is ONE settlement: verify against the provider's own record, decide
 * once, and run the same downstream effects whichever door the news came in
 * through. Every effect is individually non-fatal AND individually reported —
 * the skipped-mirror lesson, applied to money: non-fatal and silent are
 * different decisions.
 */

export interface SettlePaymentEffects {
  /** Section 9.3: flips the fulfilment alert so the order can be prepared. */
  markFulfilmentPaid(orderId: string): Promise<void>;
  /** Consumes a loyalty redemption reserved at checkout. */
  settleLoyalty(orderId: string): Promise<void>;
  /** Transactional admin email. Enqueued, not sent inline. */
  enqueueAdminEmail(orderId: string): Promise<void>;
  /**
   * What the CUSTOMER is told. Enqueued through the outbox, never sent
   * inline, and governed by the same gates as every customer message. The
   * template names the outcome the settlement actually reached.
   */
  enqueueCustomerMessage(orderId: string, template: 'ORDER_PAYMENT_SUCCESS' | 'ORDER_PAYMENT_FAILED' | 'ORDER_PAYMENT_PENDING'): Promise<void>;
  /** Purchase measurement reconciliation. */
  recordMeasurement(input: {
    verification: VerifyPesaPalPaymentOutput;
    trackingId: string;
    reference: string;
  }): Promise<void>;
  /** Where a failed effect surfaces. Never silent. */
  onEffectFailed(effect: string, orderId: string, error: unknown): void;
}

export interface SettlePaymentResult {
  verification: VerifyPesaPalPaymentOutput;
  settlement: PaymentSettlementOutcome;
  confirmed: boolean;
}

export class SettlePaymentUseCase {
  constructor(
    private readonly verify: VerifyPesaPalPaymentUseCase,
    private readonly reconcile: ReconcileOrderPaymentUseCase,
    private readonly effects: SettlePaymentEffects,
  ) {}

  async execute(input: {
    orderTrackingId: string;
    merchantReference: string;
    source: 'callback' | 'ipn' | 'poll' | 'ops_reverify';
    traceId: string;
  }): Promise<SettlePaymentResult> {
    const verification = await this.verify.execute({
      orderTrackingId: input.orderTrackingId,
      merchantReference: input.merchantReference,
      source: input.source,
    });

    // Settlement is decided ONCE, whichever door the news arrived through. An
    // unverified or unrecognised payment progresses nothing at all.
    const settlement = await this.reconcile.execute({
      verification: { ok: verification.ok, orderId: verification.orderId, status: verification.status },
      traceId: input.traceId,
    });

    if (paymentDidConfirm(settlement)) {
      // Each effect is isolated: one failing must not stop the others, and none
      // may undo a confirmed payment. But each failure is REPORTED — an effect
      // that fails silently is an obligation nobody knows they owe.
      await this.effects
        .markFulfilmentPaid(verification.orderId)
        .catch((e) => this.effects.onEffectFailed('fulfilment_payment_confirmed', verification.orderId, e));
      await this.effects
        .settleLoyalty(verification.orderId)
        .catch((e) => this.effects.onEffectFailed('loyalty_settlement', verification.orderId, e));
      await this.effects
        .enqueueAdminEmail(verification.orderId)
        .catch((e) => this.effects.onEffectFailed('admin_email', verification.orderId, e));
      await this.effects
        .recordMeasurement({ verification, trackingId: input.orderTrackingId, reference: input.merchantReference })
        .catch((e) => this.effects.onEffectFailed('measurement', verification.orderId, e));
      await this.effects
        .enqueueCustomerMessage(verification.orderId, 'ORDER_PAYMENT_SUCCESS')
        .catch((e) => this.effects.onEffectFailed('customer_message', verification.orderId, e));
    } else if (settlement.kind === 'FAILED' && settlement.orderId) {
      // A decline or reversal is the moment the customer most needs to hear
      // from us. Nothing else runs on this branch.
      await this.effects
        .enqueueCustomerMessage(settlement.orderId, 'ORDER_PAYMENT_FAILED')
        .catch((e) => this.effects.onEffectFailed('customer_message', settlement.orderId!, e));
    }

    return { verification, settlement, confirmed: paymentDidConfirm(settlement) };
  }
}
