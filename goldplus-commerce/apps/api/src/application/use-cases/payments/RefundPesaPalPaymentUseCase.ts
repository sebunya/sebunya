import { createHash } from 'node:crypto';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import { IPesaPalClient } from '../../ports/IPesaPalClient';
import { IPesaPalPaymentRepository } from '../../ports/IPesaPalPaymentRepository';
import { IRefundLedgerRepository, RefundLineAllocation } from '../../ports/IRefundLedgerRepository';
import type { ApplyRefundConsequencesUseCase } from './ApplyRefundConsequencesUseCase';

type Fail = { ok: false; code: string; message: string };

/** What RefundRequest answers when it accepts (see DrizzleRefundLedgerRepository). */
const PROVIDER_ACCEPTED = '200';
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });

/**
 * The refund path (payments brief 2026-08-06; ledger added 2026-08-07).
 *
 * "If money has been taken wrongly there is currently no way to give it back."
 * This is that way. It exists BEFORE it is ever needed, because the moment it
 * is needed is the worst possible moment to start building it.
 *
 * Guards, in order:
 *   - only a COMPLETED attempt can be refunded: a refund against anything else
 *     is refunding money that was never collected;
 *   - the amount must fit the REMAINING refundable balance — collected minus
 *     everything already refunded — not merely the original collected amount.
 *     Partials are permitted (a delivery-fee variance may owe less than the
 *     whole order), and it is precisely partials that made the old
 *     `amount <= collected` check unsafe: two 60% refunds both passed it;
 *   - the same idempotency key never pays out twice, and the reservation is
 *     taken BEFORE the provider is called, under a row lock on the attempt, so
 *     two concurrent requests cannot both see the same headroom;
 *   - line allocations, when given, must sum to the refund and must fit each
 *     line's own remaining refundable value. They are OPTIONAL: an order-level
 *     refund (delivery fee) is recorded against no line rather than smeared
 *     across products, because a per-product refund that did not happen must
 *     not be invented;
 *   - a written reason is mandatory and lands in the audit with actor, amounts
 *     and the provider's response.
 *
 * The provider processes refunds ASYNCHRONOUSLY: acceptance here is not money
 * returned. The transaction later reads REVERSED on GetTransactionStatus, and
 * the reconciliation poller — which already watches every attempt — observes
 * the reversal landing and moves the attempt through the state machine's
 * completed→reversed edge.
 *
 * If the provider call FAILS, the reservation is deliberately NOT released.
 * A failed call is not proof that no money moved; releasing the balance on a
 * timeout is exactly how a double payout happens. The row stays 'requested'
 * and an operator resolves it against the provider (ResolveRefundUseCase) — a
 * stuck reservation is recoverable, a double refund is not.
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
    private readonly ledger: IRefundLedgerRepository,
  ) {}

  async execute(input: {
    merchantReference: string;
    amountUgx: number;
    reason: string;
    actorId: string;
    actorUsername: string;
    /**
     * Optional. When absent a deterministic key is derived from the request
     * itself, so an accidental double-submit of the identical refund collapses
     * to one payout instead of two.
     */
    idempotencyKey?: string;
    lines?: RefundLineAllocation[];
  }): Promise<
    | { ok: true; providerStatus: string; providerMessage: string; refundId: string; alreadyProcessed: boolean }
    | Fail
  > {
    if (!input.reason || input.reason.trim().length < 10) {
      return fail('REASON_REQUIRED', 'A refund needs a written reason of at least 10 characters.');
    }
    if (!Number.isInteger(input.amountUgx) || input.amountUgx <= 0) {
      return fail('INVALID_AMOUNT', 'The refund amount must be a whole number of shillings above zero.');
    }

    const lines = input.lines ?? [];
    for (const line of lines) {
      if (!line.orderItemId || !Number.isInteger(line.amountUgx) || line.amountUgx <= 0) {
        return fail('INVALID_LINE_ALLOCATION', 'Every line allocation needs an order item and a whole positive amount.');
      }
    }

    const attempt = await this.attempts.findByMerchantReference(input.merchantReference);
    if (!attempt) return fail('ATTEMPT_NOT_FOUND', 'No payment attempt matches that reference.');
    if (attempt.status !== 'completed') {
      return fail(
        'NOT_REFUNDABLE',
        `Only a completed payment can be refunded. This attempt is "${attempt.status}" — no money was collected on it.`,
      );
    }

    // The derived key deliberately collapses two identical requests: same
    // reference, same amount, same reason is treated as one refund, because a
    // double-click must never return the customer's money twice. That does mean
    // a GENUINE second refund of the same amount for the same reason cannot be
    // raised on the derived key alone — it must carry an explicit
    // `idempotencyKey`, which is exactly what that input is for. Refunding
    // twice by accident is the worse failure, so the default stays safe.
    const idempotencyKey =
      input.idempotencyKey?.trim() ||
      createHash('sha256')
        .update(`${input.merchantReference}|${input.amountUgx}|${input.reason.trim()}`)
        .digest('hex')
        .slice(0, 64);

    const reservation = await this.ledger.reserveRefund({
      paymentAttemptId: attempt.id,
      orderId: attempt.orderId,
      collectedUgx: attempt.amount,
      idempotencyKey,
      amountUgx: input.amountUgx,
      reason: input.reason.trim(),
      requestedBy: input.actorId,
      lines,
    });

    if (reservation.outcome === 'EXCEEDS_REFUNDABLE_BALANCE') {
      return fail(
        'EXCEEDS_REFUNDABLE_BALANCE',
        `Only ${reservation.refundableUgx.toLocaleString('en-UG')} UGX remains refundable on this payment ` +
          `(${reservation.collectedUgx.toLocaleString('en-UG')} collected, ` +
          `${reservation.alreadyRefundedUgx.toLocaleString('en-UG')} already refunded).`,
      );
    }
    if (reservation.outcome === 'INVALID_LINE_ALLOCATION') {
      return fail('INVALID_LINE_ALLOCATION', reservation.message);
    }
    if (reservation.outcome === 'KEY_CONFLICT') {
      // Never ok:true: the key belongs to another payment's refund, so nothing
      // was reserved or sent for THIS one.
      return fail(
        'IDEMPOTENCY_KEY_CONFLICT',
        'That idempotency key was already used for a refund on a different payment. Nothing was reserved or sent; use a new key.',
      );
    }
    if (reservation.outcome === 'ALREADY_PROCESSED') {
      // A key whose request the provider REFUSED is not a payout "already
      // made": answering ok:true to it read as success while no money moved.
      // (A rejection where nothing reached the provider is re-armed by the
      // ledger and never lands here.)
      if (reservation.refund.status === 'rejected') {
        return fail(
          'ALREADY_REJECTED',
          `This refund was already refused${reservation.refund.providerMessage ? `: ${reservation.refund.providerMessage}` : '.'} No money moved. Correct it and raise it again with a new request.`,
        );
      }
      // The payout already happened (or is in flight). Report the original
      // outcome and send NOTHING to the provider.
      return {
        ok: true,
        refundId: reservation.refund.id,
        alreadyProcessed: true,
        providerStatus: reservation.refund.providerStatus ?? reservation.refund.status,
        providerMessage:
          reservation.refund.providerMessage ??
          'This refund was already requested; the original request stands and no second payout was sent.',
      };
    }

    const refund = reservation.refund;

    // The confirmation code lives at the provider; re-fetch rather than trust a
    // stored copy that may predate a renegotiated transaction.
    // A lookup failure here used to throw straight out: the reservation stayed
    // 'requested' (counted against the refundable balance, subtracted from
    // revenue) with nothing ever sent, and every retry answered "already
    // requested, no second payout was sent". Nothing can have moved before
    // RequestRefund, so a failed lookup is a rejected reservation.
    let status: Awaited<ReturnType<typeof this.client.getTransactionStatus>>;
    try {
      status = await this.client.getTransactionStatus(attempt.orderTrackingId as string);
    } catch (error) {
      await this.ledger.recordProviderOutcome(refund.id, {
        status: 'rejected',
        providerStatus: 'STATUS_LOOKUP_FAILED',
        providerMessage: error instanceof Error ? error.message.slice(0, 200) : 'Status lookup failed.',
      });
      return fail('PROVIDER_UNAVAILABLE', 'The provider could not be reached to confirm the transaction. Nothing was sent; try again shortly.');
    }
    if (!status.confirmation_code) {
      await this.ledger.recordProviderOutcome(refund.id, {
        status: 'rejected',
        providerStatus: 'NO_CONFIRMATION_CODE',
        providerMessage: 'The provider holds no confirmation code for this transaction.',
      });
      return fail('NO_CONFIRMATION_CODE', 'The provider holds no confirmation code for this transaction, so it cannot be refunded through the API.');
    }

    let response: { status: string; message: string };
    try {
      response = await this.client.requestRefund({
        confirmationCode: status.confirmation_code,
        amount: input.amountUgx,
        username: input.actorUsername,
        remarks: input.reason.trim().slice(0, 200),
      });
    } catch (error) {
      // Reservation deliberately retained — see the class comment.
      await this.ledger.recordProviderOutcome(refund.id, {
        status: 'requested',
        providerStatus: 'PROVIDER_CALL_FAILED',
        providerMessage: error instanceof Error ? error.message : String(error),
      });
      await new CreateAuditLogUseCase(this.audit).execute({
        actorId: input.actorId,
        action: 'PAYMENT_REFUND_PROVIDER_CALL_FAILED',
        entity: 'payment_refund',
        entityId: refund.id,
        previousState: { status: 'requested' },
        newState: {
          merchantReference: input.merchantReference,
          amountUgx: input.amountUgx,
          settlement: 'unknown_reservation_retained',
        },
      });
      return fail(
        'PROVIDER_CALL_FAILED',
        'The refund was recorded but the provider call failed, so it is unknown whether money moved. The amount stays reserved and must be reconciled against the provider before it is retried.',
      );
    }

    // PesaPal's RefundRequest reports a refusal INSIDE a 200 response
    // (`status: "500"` plus a message); only `status: "200"` is acceptance.
    // Recorded as 'requested' regardless, a refusal locked the amount against
    // the refundable balance for good and the admin was told it succeeded.
    // A 2xx reply with NO status says neither: PesaPal may have accepted it,
    // so releasing the amount would open a second payout. It stays
    // 'requested' (unknown) for an operator to resolve against the provider.
    const providerStatus = String(response.status ?? '').trim();
    if (providerStatus === '') {
      await this.ledger.recordProviderOutcome(refund.id, {
        status: 'requested',
        providerStatus: 'NO_PROVIDER_STATUS',
        providerMessage: response.message,
      });
      await new CreateAuditLogUseCase(this.audit).execute({
        actorId: input.actorId,
        action: 'PAYMENT_REFUND_PROVIDER_STATUS_UNKNOWN',
        entity: 'payment_refund',
        entityId: refund.id,
        previousState: { status: 'requested' },
        newState: {
          merchantReference: input.merchantReference,
          amountUgx: input.amountUgx,
          providerMessage: response.message,
          settlement: 'unknown_reservation_retained',
        },
      });
      return fail(
        'PROVIDER_STATUS_UNKNOWN',
        'The provider answered without saying whether it accepted the refund, so it is unknown whether money moved. The amount stays reserved and must be reconciled against the provider before it is retried.',
      );
    }
    if (providerStatus !== PROVIDER_ACCEPTED) {
      await this.ledger.recordProviderOutcome(refund.id, {
        status: 'rejected',
        providerStatus: String(response.status ?? '').slice(0, 40) || 'PROVIDER_REJECTED',
        providerMessage: response.message,
      });
      await new CreateAuditLogUseCase(this.audit).execute({
        actorId: input.actorId,
        action: 'PAYMENT_REFUND_REJECTED',
        entity: 'payment_refund',
        entityId: refund.id,
        previousState: { status: 'requested' },
        newState: {
          merchantReference: input.merchantReference,
          amountUgx: input.amountUgx,
          providerStatus: response.status,
          providerMessage: response.message,
          settlement: 'provider_refused_reservation_released',
        },
      });
      return fail(
        'PROVIDER_REJECTED',
        `The provider refused this refund${response.message ? `: "${response.message}"` : ''}. No money moved and the amount is refundable again.`,
      );
    }

    await this.ledger.recordProviderOutcome(refund.id, {
      status: 'requested',
      providerStatus: response.status,
      providerMessage: response.message,
    });

    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'PAYMENT_REFUND_REQUESTED',
      entity: 'payment_attempt',
      entityId: attempt.id,
      previousState: { status: attempt.status, collectedUgx: attempt.amount },
      newState: {
        refundId: refund.id,
        refundRequestedUgx: input.amountUgx,
        lineAllocations: lines,
        reason: input.reason.trim(),
        providerStatus: response.status,
        providerMessage: response.message,
        merchantReference: input.merchantReference,
        idempotencyKey,
        // The poller observes the actual reversal landing; this records the ask.
        settlement: 'async_awaiting_provider_reversal',
      },
    });

    return {
      ok: true,
      refundId: refund.id,
      alreadyProcessed: false,
      providerStatus: response.status,
      providerMessage: response.message,
    };
  }
}

/**
 * An operator resolves a refund left 'requested' — typically PROVIDER_CALL_FAILED,
 * where nobody knows whether money moved until someone checks the provider.
 *
 * The class comment always said "an operator resolves it against the
 * provider", but nothing could: the only writer was the refund request
 * itself, so a stuck reservation locked its amount for good and the only way
 * out was hand-written SQL. Settled means the operator saw the money leave;
 * rejected releases the amount. Either way a written reason and the actor are
 * audited, and a settled or rejected row is never re-resolved.
 */
export class ResolveRefundUseCase {
  constructor(
    private readonly ledger: IRefundLedgerRepository,
    private readonly audit: IAuditRepository,
    /**
     * Optional together. A refund confirmed by hand is money that went back,
     * and it means the same for the order as one the provider poll observed:
     * without these, 'settled' recorded the money and nothing else — the order
     * stayed paid and dispatchable and the points stayed with the customer.
     */
    private readonly attempts?: Pick<IPesaPalPaymentRepository, 'findAttemptsByOrderId'>,
    private readonly consequences?: Pick<ApplyRefundConsequencesUseCase, 'execute'>,
  ) {}

  async execute(input: {
    orderId: string;
    refundId: string;
    resolution: 'settled' | 'rejected';
    reason: string;
    actorId: string;
  }): Promise<{ ok: true; refundId: string; status: 'settled' | 'rejected' } | Fail> {
    if (input.resolution !== 'settled' && input.resolution !== 'rejected') {
      return fail('INVALID_RESOLUTION', 'A refund resolves to settled or rejected.');
    }
    if (!input.reason || input.reason.trim().length < 10) {
      return fail('REASON_REQUIRED', 'Resolving a refund needs a written reason of at least 10 characters.');
    }
    const refund = (await this.ledger.listRefundsForOrder(input.orderId)).find((r) => r.id === input.refundId);
    if (!refund) return fail('REFUND_NOT_FOUND', 'No refund with that id exists on this order.');
    if (refund.status !== 'requested') {
      return fail('ALREADY_RESOLVED', `This refund is already ${refund.status}.`);
    }
    await this.ledger.recordProviderOutcome(refund.id, {
      status: input.resolution,
      providerStatus: input.resolution === 'settled' ? 'OPERATOR_CONFIRMED' : 'OPERATOR_REJECTED',
      providerMessage: input.reason.trim().slice(0, 500),
    });
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: input.resolution === 'settled' ? 'PAYMENT_REFUND_RESOLVED_SETTLED' : 'PAYMENT_REFUND_RESOLVED_REJECTED',
      entity: 'payment_refund',
      entityId: refund.id,
      previousState: { status: refund.status, providerStatus: refund.providerStatus },
      newState: { status: input.resolution, reason: input.reason.trim(), amountUgx: refund.amountUgx },
    });
    if (input.resolution === 'settled' && this.attempts && this.consequences) {
      const attempt = (await this.attempts.findAttemptsByOrderId(input.orderId)).find((a) => a.id === refund.paymentAttemptId);
      // Only a still-completed attempt has consequences left to apply; a
      // reversed one was already read total and its order already cancelled.
      if (attempt && attempt.status === 'completed') {
        await this.consequences.execute(attempt, {
          actorType: 'administrator',
          actorId: input.actorId,
          source: 'admin_api',
          providerConfirmed: false,
        });
      }
    }
    return { ok: true, refundId: refund.id, status: input.resolution };
  }
}
