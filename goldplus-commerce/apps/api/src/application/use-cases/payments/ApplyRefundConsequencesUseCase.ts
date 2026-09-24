import { IRefundLedgerRepository } from '../../ports/IRefundLedgerRepository';
import { IPesaPalPaymentRepository, RecordedPaymentAttempt } from '../../ports/IPesaPalPaymentRepository';
import { IOrderTransitionPort, OrderActorType, OrderEventSource } from '../../ports/IOrderTransitionPort';
import { DomainError } from '../../../domain/errors/DomainError';

/**
 * Loyalty follow-up for money that went back (ApplyRefundToLoyaltyUseCase).
 * Idempotent: called with the share refunded TO DATE, on every verification.
 */
export interface RefundLoyaltyPort {
  execute(input: { orderId: string; refundedShareBps: number; reason: string }): Promise<void>;
}

export type RefundReading = 'partial' | 'total';

/**
 * How much of a payment has come back, read against the money collected.
 * Only a figure strictly between nothing and everything is partial: with no
 * ledger rows we cannot tell, so the safe total reading stands, and an
 * over-refund is never mistaken for a partial.
 */
export function readRefund(refundedUgx: number, collectedUgx: number): RefundReading {
  return refundedUgx > 0 && refundedUgx < collectedUgx ? 'partial' : 'total';
}

export interface RefundConsequencesResult {
  reading: RefundReading;
  refundedUgx: number;
  /** Set when a total reading met an order that can no longer be cancelled. */
  lifecycleConflict?: true;
  conflictMessage?: string;
}

/**
 * What money going back MEANS for the order: the ONE place the partial or
 * total reading turns into effects.
 *
 *   - partial: the attempt stays completed, the order stays paid, and the
 *     refunded share of the order's points is clawed back;
 *   - total: the attempt moves completed→reversed and the order is cancelled
 *     with payment 'reversed' through the canonical transition (whose
 *     cancelled subscriber carries loyalty). An order that can no longer be
 *     cancelled (delivered) keeps its status, records the payment fact and
 *     has its loyalty reversed here instead.
 *
 * It used to live only inside the provider poll, so a refund an operator
 * confirmed by hand (ResolveRefundUseCase 'settled') recorded the money and
 * nothing else: the order stayed paid and dispatchable, the attempt stayed
 * completed and the points stayed with the customer. Every step is
 * idempotent (the transition by its key, the clawback by its cumulative
 * share), so the poll and the operator may both run it.
 */
export class ApplyRefundConsequencesUseCase {
  constructor(
    private readonly paymentRepo: Pick<IPesaPalPaymentRepository, 'updatePaymentAttemptStatus' | 'updateOrderPaymentStatusSafely'>,
    private readonly orderTransition: IOrderTransitionPort,
    /** Optional so hermetic suites need no database: absent, every reversal reads total. */
    private readonly refundLedger?: Pick<IRefundLedgerRepository, 'getRefundedTotalUgx'>,
    private readonly refundLoyalty?: RefundLoyaltyPort,
  ) {}

  /** Never lets a loyalty failure fail the money path. */
  private async applyRefundToLoyalty(orderId: string, refundedShareBps: number, reason: string): Promise<void> {
    if (!this.refundLoyalty) return;
    try {
      await this.refundLoyalty.execute({ orderId, refundedShareBps, reason });
    } catch {
      // Isolated: the money fact is already recorded; the admin can reverse by hand.
    }
  }

  async execute(
    attempt: Pick<RecordedPaymentAttempt, 'id' | 'orderId' | 'amount' | 'orderTrackingId' | 'merchantReference'>,
    ctx: {
      actorType: OrderActorType;
      actorId?: string | null;
      source: OrderEventSource;
      /** True only when the provider's own status said so (the poll). */
      providerConfirmed: boolean;
    },
  ): Promise<RefundConsequencesResult> {
    const refundedUgx = this.refundLedger ? await this.refundLedger.getRefundedTotalUgx(attempt.id) : 0;
    const reading = readRefund(refundedUgx, attempt.amount);

    if (reading === 'partial') {
      await this.paymentRepo.updatePaymentAttemptStatus(attempt.id, {
        status: 'completed',
        ...(ctx.providerConfirmed ? { providerConfirmed: true } : {}),
      });
      if (attempt.amount > 0) {
        // The order never moves on a partial refund, so the lifecycle
        // subscriber never sees it: claw back the refunded share here.
        await this.applyRefundToLoyalty(attempt.orderId, Math.floor((refundedUgx * 10_000) / attempt.amount), 'Partial refund');
      }
      return { reading, refundedUgx };
    }

    await this.paymentRepo.updatePaymentAttemptStatus(attempt.id, {
      status: 'reversed',
      ...(ctx.providerConfirmed ? { providerConfirmed: true } : {}),
    });
    try {
      // The same key whichever door the news came through, so the poll and an
      // operator's resolution write one cancellation between them.
      await this.orderTransition.transition(attempt.orderId, 'cancelled', {
        actorType: ctx.actorType,
        actorId: ctx.actorId ?? null,
        source: ctx.source,
        reasonCode: 'pesapal_payment_reversed',
        paymentStatus: 'reversed',
        idempotencyKey: `pesapal:reversed:${attempt.orderTrackingId ?? attempt.merchantReference}`,
        correlationId: attempt.merchantReference,
      });
    } catch (err) {
      // The order is in a state that does not permit cancelling (a reversal
      // after delivery). Never force an illegal transition: record the payment
      // fact, reverse loyalty here, and surface it for a person.
      if (err instanceof DomainError) {
        await this.paymentRepo.updateOrderPaymentStatusSafely(attempt.orderId, 'reversed');
        await this.applyRefundToLoyalty(attempt.orderId, 10_000, 'Payment reversed by provider');
        return { reading, refundedUgx, lifecycleConflict: true, conflictMessage: err.message };
      }
      throw err;
    }
    return { reading, refundedUgx };
  }
}
