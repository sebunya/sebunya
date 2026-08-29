import { IRefundLedgerRepository } from '../../ports/IRefundLedgerRepository';
import { IPesaPalPaymentRepository, RecordedPaymentAttempt } from '../../ports/IPesaPalPaymentRepository';
import { IPesaPalClient } from '../../ports/IPesaPalClient';
import { IOrderTransitionPort } from '../../ports/IOrderTransitionPort';
import { OrderStatus } from '../../../domain/commerce/Order';
import { DomainError } from '../../../domain/errors/DomainError';

export interface VerifyPesaPalPaymentInput {
  orderTrackingId: string;
  merchantReference: string;
  /**
   * `poll` is the reconciliation safety net asking on a schedule;
   * `ops_reverify` is a human asking from the payment queue. Neither stamps a
   * callback/IPN receipt time, because neither is one.
   */
  source: 'callback' | 'ipn' | 'poll' | 'ops_reverify';
}

export interface VerifyPesaPalPaymentOutput {
  ok: boolean;
  status: string;
  amount: number;
  currency: string;
  orderId: string;
  message?: string;
  /**
   * The provider's answer was established, but the ORDER could not accept it.
   *
   * A completed payment against an order that can no longer transition (it was
   * cancelled, say) is real money on an order that cannot receive it. That needs
   * a person, not a confirmation: without this flag the caller saw a verified
   * `completed` and ran every success effect — marking fulfilment paid, settling
   * loyalty and telling the customer "payment received" — on an order whose own
   * state machine had just refused the move.
   */
  lifecycleConflict?: boolean;
}

export class VerifyPesaPalPaymentUseCase {
  private paymentRepo: IPesaPalPaymentRepository;
  private pesapalClient: IPesaPalClient;
  private orderTransition: IOrderTransitionPort;
  private refundLedger?: IRefundLedgerRepository;

  constructor(
    paymentRepo: IPesaPalPaymentRepository,
    pesapalClient: IPesaPalClient,
    orderTransition: IOrderTransitionPort,
    /**
     * Optional so the hermetic unit suites can construct this without a
     * database. Absent, a provider reversal is treated as TOTAL — the safe
     * reading, and exactly what happened before the ledger existed.
     */
    refundLedger?: IRefundLedgerRepository,
  ) {
    this.paymentRepo = paymentRepo;
    this.pesapalClient = pesapalClient;
    this.orderTransition = orderTransition;
    this.refundLedger = refundLedger;
  }

  async execute(input: VerifyPesaPalPaymentInput): Promise<VerifyPesaPalPaymentOutput> {
    const trackingId = input.orderTrackingId.trim();
    const reference = input.merchantReference.trim();

    if (!trackingId || !reference) {
      return {
        ok: false,
        status: 'verification_failed',
        amount: 0,
        currency: 'UGX',
        orderId: '',
        message: 'MISSING_REQUIRED_PARAMS: Missing OrderTrackingId or OrderMerchantReference.',
      };
    }

    // 1. Resolve local payment attempt
    const attempt = await this.paymentRepo.findByTrackingId(trackingId);
    if (!attempt) {
      return {
        ok: false,
        status: 'verification_failed',
        amount: 0,
        currency: 'UGX',
        orderId: '',
        message: `MISSING_PAYMENT_ATTEMPT: Local payment attempt with tracking ID "${trackingId}" not found.`,
      };
    }

    // Mark attempt webhook/callback received timestamp
    const now = new Date();
    await this.paymentRepo.updatePaymentAttemptStatus(attempt.id, {
      status: attempt.status,
      callbackReceivedAt: input.source === 'callback' ? now : undefined,
      ipnReceivedAt: input.source === 'ipn' ? now : undefined,
    });

    // If already COMPLETED, return immediately (idempotency key protection).
    //
    // EXCEPT when a refund on this attempt is still waiting on the provider.
    // This early return is correct for a duplicate callback or IPN, but it was
    // unconditional — so once an attempt reached 'completed' the provider was
    // never asked again, and the completed→reversed edge the state machine
    // declares had no reachable writer at all. A refund could be requested and
    // never observed landing. Looking again costs one provider call, and only
    // when the ledger says something is genuinely outstanding.
    const awaitingRefund =
      attempt.status === 'completed' && this.refundLedger
        ? await this.refundLedger.hasOutstandingRefunds(attempt.id)
        : false;

    if (attempt.status === 'completed' && !awaitingRefund) {
      return {
        ok: true,
        status: 'completed',
        amount: attempt.amount,
        currency: attempt.currency,
        orderId: attempt.orderId,
        message: 'PAYMENT_ALREADY_COMPLETED: Idempotent replay received.',
      };
    }

    // 2. Call authoritative transaction status endpoint
    let statusResponse;
    try {
      statusResponse = await this.pesapalClient.getTransactionStatus(trackingId);
    } catch (err: any) {
      return {
        ok: false,
        status: 'verification_pending',
        amount: attempt.amount,
        currency: attempt.currency,
        orderId: attempt.orderId,
        message: `PESAPAL_STATUS_API_FAILED: PesaPal status call failed. Details: ${err.message}`,
      };
    }

    // 3. Strict Verification & Integrity Checks
    // - Verify merchant reference
    if (statusResponse.merchant_reference !== reference || statusResponse.merchant_reference !== attempt.merchantReference) {
      await this.paymentRepo.updatePaymentAttemptStatus(attempt.id, { status: 'verification_failed' });
      return {
        ok: false,
        status: 'verification_failed',
        amount: attempt.amount,
        currency: attempt.currency,
        orderId: attempt.orderId,
        message: `INTEGRITY_VIOLATION: Merchant reference mismatch. Expected "${attempt.merchantReference}", got "${statusResponse.merchant_reference}".`,
      };
    }

    // - Verify amount
    if (statusResponse.amount !== attempt.amount) {
      await this.paymentRepo.updatePaymentAttemptStatus(attempt.id, { status: 'verification_failed' });
      return {
        ok: false,
        status: 'verification_failed',
        amount: attempt.amount,
        currency: attempt.currency,
        orderId: attempt.orderId,
        message: `INTEGRITY_VIOLATION: Payment amount mismatch. Expected ${attempt.amount}, got ${statusResponse.amount}.`,
      };
    }

    // - Verify currency
    if (statusResponse.currency.toUpperCase() !== attempt.currency.toUpperCase()) {
      await this.paymentRepo.updatePaymentAttemptStatus(attempt.id, { status: 'verification_failed' });
      return {
        ok: false,
        status: 'verification_failed',
        amount: attempt.amount,
        currency: attempt.currency,
        orderId: attempt.orderId,
        message: `INTEGRITY_VIOLATION: Currency mismatch. Expected "${attempt.currency}", got "${statusResponse.currency}".`,
      };
    }

    // 4. Map PesaPal transaction status code to internal model.
    // 0 = INVALID, 1 = COMPLETED, 2 = FAILED, 3 = REVERSED.
    //
    // A payment result may authorise a LIFECYCLE transition (completed => order
    // moves to processing; reversed => cancelled). Those go through the ONE
    // canonical, transactional, append-only transition path, which commits the
    // payment status AND the status change AND exactly one order_event together.
    // A failed/invalid payment authorises NO lifecycle transition: the order
    // keeps its current status and only its payment status is recorded. There is
    // deliberately no `received -> pending_payment` move — that is not a legal
    // state-machine transition, so no synthetic lifecycle event is invented.
    let mappedStatus = 'pending';
    let orderPaymentStatus: 'paid' | 'failed' | 'reversed' | 'unpaid' = 'unpaid';
    let lifecycleTarget: OrderStatus | null = null;
    let reasonCode = 'pesapal_verification';

    switch (statusResponse.status_code) {
      case 1:
        mappedStatus = 'completed';
        orderPaymentStatus = 'paid';
        lifecycleTarget = 'processing';
        reasonCode = 'pesapal_payment_completed';
        break;
      case 3: {
        // A provider reversal is reported per TRANSACTION, so it says nothing
        // about how much came back. Ask the refund ledger.
        //
        // Treating every reversal as total used to cancel the customer's whole
        // order and wipe its revenue — so a 5,000 UGX delivery-fee refund
        // cancelled a 500,000 UGX order that had already been paid and
        // fulfilled. Only a reversal the ledger PROVES is partial diverges;
        // with no ledger rows we cannot tell, so the safe total reading stands.
        const refunded = this.refundLedger ? await this.refundLedger.getRefundedTotalUgx(attempt.id) : 0;
        const provenPartial = refunded > 0 && refunded < attempt.amount;

        if (provenPartial) {
          // Money WAS collected and only part of it returned: the attempt stays
          // completed, the order stays paid, and nothing is cancelled. How much
          // came back lives in the ledger, which the commercial projection
          // subtracts line by line.
          mappedStatus = 'completed';
          orderPaymentStatus = 'paid';
          lifecycleTarget = null;
          reasonCode = 'pesapal_payment_partially_refunded';
        } else {
          mappedStatus = 'reversed';
          orderPaymentStatus = 'reversed';
          lifecycleTarget = 'cancelled';
          reasonCode = 'pesapal_payment_reversed';
        }

        // The provider confirms that a reversal happened; it does NOT say which
        // of our outstanding refund rows it corresponds to. So the ceiling here
        // is the only figure we can actually stand behind: the money that was
        // COLLECTED on this attempt. Outstanding refunds settle oldest first
        // until that is exhausted, and we can never mark more money returned
        // than was ever taken.
        //
        // Passing `refunded` here instead would be circular — that total is the
        // sum of these very rows, so it always covers them all and caps nothing.
        if (this.refundLedger) {
          await this.refundLedger.settleRefundsForAttempt(attempt.id, attempt.amount);
        }
        break;
      }
      case 2:
        mappedStatus = 'failed';
        orderPaymentStatus = 'failed';
        break;
      case 0:
      default:
        mappedStatus = 'invalid';
        orderPaymentStatus = 'failed';
        break;
    }

    // 5. Persist the verification outcome on the payment attempt.
    await this.paymentRepo.updatePaymentAttemptStatus(attempt.id, { status: mappedStatus });

    // 6. Apply the order-side effect.
    if (lifecycleTarget) {
      // Legal lifecycle move authorised by the verified payment. The canonical
      // service commits payment status + status + one event atomically. The
      // actor is the verified payment provider — never a request field. The
      // stable idempotency key means a retried callback/IPN writes no duplicate.
      try {
        await this.orderTransition.transition(attempt.orderId, lifecycleTarget, {
          actorType: 'payment_provider',
          source: 'payment',
          reasonCode,
          paymentStatus: orderPaymentStatus,
          idempotencyKey: `pesapal:${mappedStatus}:${trackingId}`,
          correlationId: reference,
        });
      } catch (err) {
        // The order is in a state that does not permit this lifecycle move (e.g.
        // a reversal arriving after the order already completed). Do NOT force an
        // illegal transition or invent an event; record the payment fact only and
        // surface it for manual reconciliation.
        if (err instanceof DomainError) {
          await this.paymentRepo.updateOrderPaymentStatusSafely(attempt.orderId, orderPaymentStatus);
          return {
            ok: mappedStatus === 'completed',
            // Named, not merely described in a message nobody reads. This is what
            // routes the settlement to REVIEW_REQUIRED instead of CONFIRMED.
            lifecycleConflict: true,
            status: mappedStatus,
            amount: attempt.amount,
            currency: attempt.currency,
            orderId: attempt.orderId,
            message: `LIFECYCLE_CONFLICT: payment resolved to "${mappedStatus}" but the order could not transition (${err.message}); payment status recorded for manual review.`,
          };
        }
        throw err;
      }

      if (mappedStatus === 'completed') {
        return {
          ok: true,
          status: 'completed',
          amount: attempt.amount,
          currency: attempt.currency,
          orderId: attempt.orderId,
        };
      }
      return {
        ok: false,
        status: mappedStatus,
        amount: attempt.amount,
        currency: attempt.currency,
        orderId: attempt.orderId,
        message: `PAYMENT_${mappedStatus.toUpperCase()}: Transaction resolved to state "${mappedStatus}" (PesaPal: ${statusResponse.payment_status_description}).`,
      };
    }

    // Failed/invalid payment: record the payment status only; the order lifecycle
    // is unchanged and no order_event is written.
    await this.paymentRepo.updateOrderPaymentStatusSafely(attempt.orderId, orderPaymentStatus);
    return {
      ok: false,
      status: mappedStatus,
      amount: attempt.amount,
      currency: attempt.currency,
      orderId: attempt.orderId,
      message: `PAYMENT_UNPAID: Transaction resolved to state "${mappedStatus}" (PesaPal: ${statusResponse.payment_status_description}).`,
    };
  }
}
