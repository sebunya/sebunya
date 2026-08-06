import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { IPesaPalClient } from '../../ports/IPesaPalClient';
import { IPesaPalPaymentRepository } from '../../ports/IPesaPalPaymentRepository';

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

/**
 * The refund path (payments brief, 2026-08-06).
 *
 * "If money has been taken wrongly there is currently no way to give it back."
 * This is that way. It exists BEFORE it is ever needed, because the moment it
 * is needed is the worst possible moment to start building it.
 *
 * Guards, in order:
 *   - only a COMPLETED attempt can be refunded: a refund against anything else
 *     is refunding money that was never collected;
 *   - the amount may not exceed what was collected, and partials are permitted
 *     because a delivery-fee variance may owe less than the whole order;
 *   - a written reason is mandatory and lands in the audit with actor, amounts
 *     and the provider's response.
 *
 * The provider processes refunds ASYNCHRONOUSLY: acceptance here is not money
 * returned. The transaction later reads REVERSED on GetTransactionStatus, and
 * the reconciliation poller — which already watches every attempt — observes
 * the reversal landing and moves the attempt through the state machine's
 * completed→reversed edge. No second bookkeeping mechanism is needed.
 *
 * UNEXERCISED AGAINST REAL MONEY: no completed payment has ever existed in
 * this system, so no refund has ever been issued. Proven synthetically only,
 * and said plainly here and in the report.
 */
export class RefundPesaPalPaymentUseCase {
  constructor(
    private readonly attempts: IPesaPalPaymentRepository,
    private readonly client: IPesaPalClient,
    private readonly audit: IAuditRepository,
  ) {}

  async execute(input: {
    merchantReference: string;
    amountUgx: number;
    reason: string;
    actorId: string;
    actorUsername: string;
  }): Promise<{ ok: true; providerStatus: string; providerMessage: string } | Fail> {
    if (!input.reason || input.reason.trim().length < 10) {
      return fail('REASON_REQUIRED', 'A refund needs a written reason of at least 10 characters.');
    }
    if (!Number.isInteger(input.amountUgx) || input.amountUgx <= 0) {
      return fail('INVALID_AMOUNT', 'The refund amount must be a whole number of shillings above zero.');
    }

    const attempt = await this.attempts.findByMerchantReference(input.merchantReference);
    if (!attempt) return fail('ATTEMPT_NOT_FOUND', 'No payment attempt matches that reference.');
    if (attempt.status !== 'completed') {
      return fail(
        'NOT_REFUNDABLE',
        `Only a completed payment can be refunded. This attempt is "${attempt.status}" — no money was collected on it.`,
      );
    }
    if (input.amountUgx > attempt.amount) {
      return fail(
        'AMOUNT_EXCEEDS_COLLECTED',
        `The refund of ${input.amountUgx.toLocaleString('en-UG')} UGX exceeds the ${attempt.amount.toLocaleString('en-UG')} UGX collected.`,
      );
    }

    // The confirmation code lives at the provider; re-fetch rather than trust a
    // stored copy that may predate a renegotiated transaction.
    const status = await this.client.getTransactionStatus(attempt.orderTrackingId as string);
    if (!status.confirmation_code) {
      return fail('NO_CONFIRMATION_CODE', 'The provider holds no confirmation code for this transaction, so it cannot be refunded through the API.');
    }

    const response = await this.client.requestRefund({
      confirmationCode: status.confirmation_code,
      amount: input.amountUgx,
      username: input.actorUsername,
      remarks: input.reason.trim().slice(0, 200),
    });

    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'PAYMENT_REFUND_REQUESTED',
      entity: 'payment_attempt',
      entityId: attempt.id,
      previousState: { status: attempt.status, collectedUgx: attempt.amount },
      newState: {
        refundRequestedUgx: input.amountUgx,
        reason: input.reason.trim(),
        providerStatus: response.status,
        providerMessage: response.message,
        merchantReference: input.merchantReference,
        // The poller observes the actual reversal landing; this records the ask.
        settlement: 'async_awaiting_provider_reversal',
      },
    });

    return { ok: true, providerStatus: response.status, providerMessage: response.message };
  }
}
