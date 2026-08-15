import {
  IPasswordResetDeliveryRepository,
  PasswordResetOperationSnapshot,
} from '../../ports/IPasswordResetDelivery';
import {
  classifyProviderResponse,
  decideAfterProviderOutcome,
  operationBlockedBy,
  ProviderOutcome,
  ResetOperationSnapshot,
} from '../../../domain/identity/PasswordResetDelivery';

/**
 * Executes ONE password-reset delivery attempt.
 *
 * Shared by the initial synchronous send and by every retry, deliberately: a
 * weaker retry path would be a second place for the dispatch boundary to be got
 * wrong, and the boundary is the whole safety story.
 *
 * THE SHAPE, AND WHY IT IS THIS SHAPE
 *
 *   1. re-prove eligibility          (a schedule made an hour ago knows nothing)
 *   2. CAS  PREPARED → DISPATCH_STARTED, COMMIT
 *   3. call the provider             (no database lock held across the network)
 *   4. CAS  DISPATCH_STARTED → terminal
 *   5. apply the token-preservation matrix
 *
 * Step 2 commits BEFORE step 3 so that a crash between them is legible: the
 * durable record says a dispatch may have happened, which is the only honest
 * reading. Reversed, a dead process would leave a PREPARED attempt that had in
 * fact reached ZeptoMail, and recovery would cheerfully mint a replacement
 * credential while the first email was still in flight.
 *
 * THE TOKEN RULE, IN ONE LINE
 *
 * A credential stays usable only while an email carrying it was accepted, or
 * might have been. Anything else retires it.
 */

export interface ResetTransportResult {
  responded: boolean;
  httpStatus?: number | null;
  providerBody?: string | null;
  retryAfterSeconds?: number | null;
  providerReference?: string | null;
  transportError?: string | null;
}

export interface ResetTransport {
  /** Sends the link. The raw token lives only in this call's arguments. */
  send(input: { recipient: string; resetUrl: string }): Promise<ResetTransportResult>;
}

export interface AttemptTransitions {
  transitionStatus(input: {
    attemptId: string;
    expectedStatus: string;
    nextStatus: string;
    providerCode?: string | null;
    providerMessage?: string | null;
  }): Promise<boolean>;
}

export type DeliveryResult =
  | { kind: 'ACCEPTED' }
  | { kind: 'RETRY_SCHEDULED'; nextAttemptAt: Date }
  | { kind: 'TERMINAL'; reason: string }
  | { kind: 'AMBIGUOUS'; reason: string }
  | { kind: 'NOT_DISPATCHED'; reason: string };

const toDomainSnapshot = (s: PasswordResetOperationSnapshot): ResetOperationSnapshot => ({
  operationId: s.operationId,
  rootCreatedAt: s.rootCreatedAt,
  consumedAt: s.consumedAt,
  revokedAt: null,
  supersededByNewerUserRequest: false,
  deliveryAttempts: s.dispatchedAttempts,
});

export class DeliverPasswordResetUseCase {
  constructor(
    private readonly repo: IPasswordResetDeliveryRepository,
    private readonly attempts: AttemptTransitions,
    private readonly transport: ResetTransport,
    private readonly publicBaseUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: {
    operationId: string;
    tokenId: string;
    attemptId: string;
    /** Raw token. Held in memory for this call only, never persisted or logged. */
    rawToken: string;
  }): Promise<DeliveryResult> {
    const at = this.now();

    // 1. SEND-TIME RECHECK. Not a repeat of the claim-time check: between the
    //    two the customer may have reset their password with an earlier token,
    //    or the operation may simply have run out of time.
    const snapshot = await this.repo.loadOperation(input.operationId);
    if (!snapshot) {
      // Orphaned: no root row. Fail closed rather than inventing an operation.
      await this.abandon(input.attemptId, 'RESET_OPERATION_ORPHANED');
      return { kind: 'NOT_DISPATCHED', reason: 'RESET_OPERATION_ORPHANED' };
    }

    const blocked = operationBlockedBy(toDomainSnapshot(snapshot), at);
    if (blocked) {
      await this.abandon(input.attemptId, `OPERATION_${blocked}`);
      await this.repo.supersedeToken(input.tokenId);
      await this.repo.finaliseIntent({ operationId: input.operationId, terminalReason: `OBSOLETE_${blocked}` });
      return { kind: 'NOT_DISPATCHED', reason: `OPERATION_${blocked}` };
    }

    if (snapshot.currentToken?.id !== input.tokenId) {
      // Somebody rotated underneath us. Sending this token would deliver a link
      // that is no longer the operation's credential.
      await this.abandon(input.attemptId, 'TOKEN_NO_LONGER_CURRENT');
      return { kind: 'NOT_DISPATCHED', reason: 'TOKEN_NO_LONGER_CURRENT' };
    }

    // 2. DURABLE DISPATCH BOUNDARY. Commit first, ask questions later.
    const crossed = await this.attempts.transitionStatus({
      attemptId: input.attemptId,
      expectedStatus: 'PREPARED',
      nextStatus: 'DISPATCH_STARTED',
    });
    if (!crossed) {
      // Another execution owns this attempt. Calling the provider anyway would
      // be a send on the far side of a boundary we never crossed.
      return { kind: 'NOT_DISPATCHED', reason: 'DISPATCH_BOUNDARY_LOST' };
    }

    // 3. The network call. The raw token exists only here, in the URL we build.
    const resetUrl = `${this.publicBaseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(input.rawToken)}`;
    let transport: ResetTransportResult;
    try {
      transport = await this.transport.send({ recipient: snapshot.recipientEmail, resetUrl });
    } catch (error) {
      transport = {
        responded: false,
        transportError: error instanceof Error ? error.message.slice(0, 200) : 'TRANSPORT_THREW',
      };
    }

    const outcome = classifyProviderResponse(transport);

    // 4 + 5. Record the verdict, then apply the token rule.
    return this.settle({ ...input, outcome, snapshot, at });
  }

  /** PREPARED → NOT_DISPATCHED. Never FAILED: the provider rejected nothing. */
  private async abandon(attemptId: string, reason: string): Promise<void> {
    await this.attempts.transitionStatus({
      attemptId,
      expectedStatus: 'PREPARED',
      nextStatus: 'NOT_DISPATCHED',
      providerCode: 'NOT_DISPATCHED',
      providerMessage: reason,
    });
  }

  private async settle(input: {
    operationId: string;
    tokenId: string;
    attemptId: string;
    outcome: ProviderOutcome;
    snapshot: PasswordResetOperationSnapshot;
    at: Date;
  }): Promise<DeliveryResult> {
    const { outcome } = input;

    if (outcome.kind === 'ACCEPTED') {
      await this.attempts.transitionStatus({
        attemptId: input.attemptId,
        expectedStatus: 'DISPATCH_STARTED',
        nextStatus: 'SENT',
        providerCode: outcome.providerReference ?? 'ACCEPTED',
        providerMessage: 'Provider accepted the message. Not proof of mailbox delivery.',
      });
      await this.repo.finaliseIntent({
        operationId: input.operationId,
        terminalReason: 'PROVIDER_ACCEPTED',
      });
      return { kind: 'ACCEPTED' };
    }

    if (outcome.kind === 'AMBIGUOUS') {
      // The message may be in flight. Record the ambiguity durably and touch
      // NOTHING else — no rotation, no resend, no retry schedule.
      await this.attempts.transitionStatus({
        attemptId: input.attemptId,
        expectedStatus: 'DISPATCH_STARTED',
        nextStatus: 'OUTCOME_UNKNOWN',
        providerCode: 'OUTCOME_UNKNOWN',
        providerMessage: outcome.reason.slice(0, 300),
      });
      await this.repo.finaliseIntent({
        operationId: input.operationId,
        terminalReason: `PROVIDER_OUTCOME_AMBIGUOUS:${outcome.reason}`,
      });
      return { kind: 'AMBIGUOUS', reason: outcome.reason };
    }

    // Definitive non-acceptance. The provider proved it does not have the
    // message, so the credential it carried is retired REGARDLESS of whether we
    // will try again — those are two separate decisions.
    await this.attempts.transitionStatus({
      attemptId: input.attemptId,
      expectedStatus: 'DISPATCH_STARTED',
      nextStatus: 'FAILED',
      providerCode: `PROVIDER_${outcome.classification.toUpperCase()}`,
      providerMessage: `class=${outcome.classification} disposition=${outcome.disposition}`,
    });

    const decision = decideAfterProviderOutcome({
      outcome,
      snapshot: toDomainSnapshot(input.snapshot),
      now: input.at,
    });

    if (decision.action === 'SUPERSEDE_AND_SCHEDULE_RETRY') {
      const armed = await this.repo.supersedeAndScheduleRetry({
        operationId: input.operationId,
        tokenId: input.tokenId,
        nextAttemptAt: decision.nextAttemptAt,
        reason: decision.reason,
      });
      if (!armed) return { kind: 'TERMINAL', reason: 'RETRY_NOT_ARMED' };
      return { kind: 'RETRY_SCHEDULED', nextAttemptAt: decision.nextAttemptAt };
    }

    // TERMINAL or HOLD: no further automated contact. The token still goes,
    // because the provider definitively did not accept it.
    await this.repo.supersedeToken(input.tokenId);
    const reason =
      decision.action === 'TERMINAL' ? decision.terminalReason : decision.reason;
    await this.repo.finaliseIntent({ operationId: input.operationId, terminalReason: reason });
    return { kind: 'TERMINAL', reason };
  }
}
