import { IPesaPalPaymentRepository, RecordedPaymentAttempt } from '../../ports/IPesaPalPaymentRepository';
import { IPesaPalClient } from '../../ports/IPesaPalClient';

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

  constructor(paymentRepo: IPesaPalPaymentRepository, pesapalClient: IPesaPalClient) {
    this.paymentRepo = paymentRepo;
    this.pesapalClient = pesapalClient;
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

    // 4. Map PesaPal transaction status code to internal model
    // 0 = INVALID, 1 = COMPLETED, 2 = FAILED, 3 = REVERSED
    let mappedStatus = 'pending';
    let orderPaymentStatus: 'paid' | 'failed' | 'reversed' | 'unpaid' = 'unpaid';
    let orderStatus: 'processing' | 'received' | 'pending_payment' | 'cancelled' = 'received';

    switch (statusResponse.status_code) {
      case 1:
        mappedStatus = 'completed';
        orderPaymentStatus = 'paid';
        orderStatus = 'processing';
        break;
      case 2:
        mappedStatus = 'failed';
        orderPaymentStatus = 'failed';
        orderStatus = 'pending_payment';
        break;
      case 3:
        mappedStatus = 'reversed';
        orderPaymentStatus = 'reversed';
        orderStatus = 'cancelled';
        break;
      case 0:
      default:
        mappedStatus = 'invalid';
        orderPaymentStatus = 'failed';
        orderStatus = 'pending_payment';
        break;
    }

    // 5. Persist safe status updates to payment_attempts
    await this.paymentRepo.updatePaymentAttemptStatus(attempt.id, { status: mappedStatus });

    // 6. Update order status safely only when verified completed/failed
    if (mappedStatus === 'completed') {
      await this.paymentRepo.updateOrderPaymentStatusSafely(attempt.orderId, orderPaymentStatus, orderStatus);
      return {
        ok: true,
        status: 'completed',
        amount: attempt.amount,
        currency: attempt.currency,
        orderId: attempt.orderId,
      };
    } else {
      await this.paymentRepo.updateOrderPaymentStatusSafely(attempt.orderId, orderPaymentStatus, orderStatus);
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
}
