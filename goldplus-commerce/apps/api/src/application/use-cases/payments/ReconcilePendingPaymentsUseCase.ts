import { RecordedPaymentAttempt } from '../../ports/IPesaPalPaymentRepository';
import { SettlePaymentUseCase } from './SettlePaymentUseCase';

/**
 * The reconciliation poller (payments brief, 2026-08-06).
 *
 * THE SAFETY NET FOR EVERY MISSED CALLBACK, and it must exist even after
 * callbacks work: in a Ugandan mobile money collection the money leaves the
 * customer's wallet the moment they enter their PIN, before our system hears
 * anything. A customer who paid and closed the tab, an IPN lost in transit, a
 * provider outage during the callback — every one of those looks identical
 * from our side: an attempt sitting in `pending`. Production held five of them,
 * from May to August, because nothing ever asked again.
 *
 * `StartOrderPaymentUseCase` even records ORDER_PAYMENT_VERIFICATION_REQUIRED
 * as a durable event for exactly this purpose. It was written and never
 * consumed — the safety net was designed, and nobody hung it up. This is the
 * consumer, reading the attempts table directly so it also covers attempts
 * that predate that event.
 *
 * TWO RULES, both structural:
 *
 *   1. TIME NEVER MARKS A PAYMENT FAILED. The threshold decides only when we
 *      ASK; what gets written is exclusively the provider's own answer, through
 *      the same verify + settle path the IPN uses. A customer takes 60–120
 *      seconds to find their phone and enter a PIN, telcos settle late, and a
 *      timeout-marked failure while the telco later succeeds is exactly how
 *      money gets taken with no order. This use case cannot express that
 *      failure mode: it has no code path that writes a status of its own.
 *
 *   2. ABANDONMENT IS ONLY FOR ATTEMPTS WITH NO PROVIDER TRANSACTION. An
 *      attempt with no tracking id means SubmitOrderRequest never succeeded:
 *      no payment page existed, nothing can be asked, and no money is possible
 *      by construction. Only those may close as `abandoned`, and that is a
 *      statement about our record, never about the provider.
 */

export interface ReconcilePendingPaymentsResult {
  polled: number;
  confirmed: number;
  failed: number;
  stillPending: number;
  abandoned: number;
  errors: Array<{ merchantReference: string; message: string }>;
}

export class ReconcilePendingPaymentsUseCase {
  constructor(
    private readonly attempts: {
      listAttemptsForReconciliation(olderThan: Date, limit: number): Promise<RecordedPaymentAttempt[]>;
      /** Optional: an adapter without it simply never revisits paid attempts for refunds. */
      listCompletedAttemptsAwaitingRefund?(limit: number): Promise<RecordedPaymentAttempt[]>;
      listStartFailuresForAbandonment(olderThan: Date, limit: number): Promise<RecordedPaymentAttempt[]>;
      updatePaymentAttemptStatus(id: string, update: { status: string }): Promise<RecordedPaymentAttempt>;
    },
    private readonly settle: SettlePaymentUseCase,
    private readonly config: {
      /** How long an attempt may sit before we ask the provider. */
      pollAfterMinutes: number;
      /** How long a no-transaction attempt may sit before closing as abandoned. */
      abandonStartFailuresAfterHours: number;
      batchLimit: number;
    },
  ) {}

  async execute(now: Date = new Date()): Promise<ReconcilePendingPaymentsResult> {
    const result: ReconcilePendingPaymentsResult = {
      polled: 0,
      confirmed: 0,
      failed: 0,
      stillPending: 0,
      abandoned: 0,
      errors: [],
    };

    const pollBefore = new Date(now.getTime() - this.config.pollAfterMinutes * 60_000);
    // Live attempts the provider may have settled, PLUS paid attempts with a
    // refund outstanding: those were never polled, so a refund landed only if
    // the provider chose to tell us.
    const stale = [
      ...(await this.attempts.listAttemptsForReconciliation(pollBefore, this.config.batchLimit)),
      ...((await this.attempts.listCompletedAttemptsAwaitingRefund?.(this.config.batchLimit)) ?? []),
    ];

    for (const attempt of stale) {
      result.polled++;
      try {
        // The SAME settlement path as the IPN. A payment the poller finds
        // completed gets fulfilment, loyalty, the admin email and measurement
        // exactly as if the callback had arrived on time.
        const outcome = await this.settle.execute({
          orderTrackingId: attempt.orderTrackingId as string,
          merchantReference: attempt.merchantReference,
          source: 'poll',
          traceId: `poll:${attempt.merchantReference}`,
        });
        if (outcome.confirmed) result.confirmed++;
        else if (outcome.verification.status === 'pending' || outcome.verification.status === 'verification_pending') {
          result.stillPending++;
        } else {
          result.failed++;
        }
      } catch (e) {
        result.errors.push({
          merchantReference: attempt.merchantReference,
          message: e instanceof Error ? e.message.slice(0, 200) : String(e),
        });
      }
    }

    const abandonBefore = new Date(now.getTime() - this.config.abandonStartFailuresAfterHours * 3_600_000);
    const startFailures = await this.attempts.listStartFailuresForAbandonment(abandonBefore, this.config.batchLimit);
    for (const attempt of startFailures) {
      try {
        await this.attempts.updatePaymentAttemptStatus(attempt.id, { status: 'abandoned' });
        result.abandoned++;
      } catch (e) {
        result.errors.push({
          merchantReference: attempt.merchantReference,
          message: e instanceof Error ? e.message.slice(0, 200) : String(e),
        });
      }
    }

    return result;
  }
}
