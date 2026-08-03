import { IPesaPalPaymentRepository, RecordedPaymentAttempt } from '../../ports/IPesaPalPaymentRepository';
import { IPesaPalClient } from '../../ports/IPesaPalClient';
import { IOrderTransitionPort } from '../../ports/IOrderTransitionPort';
import { OrderStatus } from '../../../domain/commerce/Order';
import { DomainError } from '../../../domain/errors/DomainError';

export interface VerifyPesaPalPaymentInput {
  orderTrackingId: string;
  merchantReference: string;
  source: 'callback' | 'ipn';
}

export interface VerifyPesaPalPaymentOutput {
  ok: boolean;
  status: string;
  amount: number;
  currency: string;
  orderId: string;
  message?: string;
}

export class VerifyPesaPalPaymentUseCase {
  private paymentRepo: IPesaPalPaymentRepository;
  private pesapalClient: IPesaPalClient;
  private orderTransition: IOrderTransitionPort;

  constructor(
    paymentRepo: IPesaPalPaymentRepository,
    pesapalClient: IPesaPalClient,
    orderTransition: IOrderTransitionPort,
  ) {
    this.paymentRepo = paymentRepo;
    this.pesapalClient = pesapalClient;
    this.orderTransition = orderTransition;
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

    // If already COMPLETED, return immediately (idempotency key protection)
    if (attempt.status === 'completed') {
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
      case 3:
        mappedStatus = 'reversed';
        orderPaymentStatus = 'reversed';
        lifecycleTarget = 'cancelled';
        reasonCode = 'pesapal_payment_reversed';
        break;
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
