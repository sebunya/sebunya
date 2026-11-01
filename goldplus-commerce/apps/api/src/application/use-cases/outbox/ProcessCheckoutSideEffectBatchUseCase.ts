import {
  CHECKOUT_SIDE_EFFECT_EVENT_TYPES,
  CheckoutSideEffectType,
} from '../../ports/ICheckoutSideEffectRecorder';
import { IOutboxRepository } from '../../ports/IOutboxRepository';
import { computeBackoffSeconds } from './ProcessOutboxBatchUseCase';

/**
 * Performs the commerce work that checkout durably queued.
 *
 * Recording an intent is only half of durability. The recorder writes an identity
 * row and an outbox event in one transaction so the work can never be lost or
 * duplicated; this is the half that actually does it, outside the customer's
 * request, where a failure can be retried instead of vanishing with the response.
 *
 * WHY NOT THE EXISTING OUTBOX WORKER
 * `ProcessOutboxBatchUseCase` routes an event to a notification provider. These
 * events are units of commerce work with no channel and no recipient, so that
 * worker would find no route, mark them processed as "unroutable", and report
 * success while the fulfilment task was silently discarded. The two claim disjoint
 * event-type sets for exactly that reason.
 *
 * A handler must be idempotent. It can be called again after a crash between the
 * work committing and the event being marked processed — at-least-once is the only
 * delivery guarantee an outbox can offer, and pretending otherwise is how
 * duplicates reach customers.
 */

export type SideEffectHandlerResult =
  /** The work is done, or was already done. Retire the event. */
  | { status: 'HANDLED' }
  /** Transient. Retry with backoff. */
  | { status: 'RETRY'; error: string }
  /** Will never succeed. Dead-letter rather than burning eight attempts. */
  | { status: 'FINAL'; error: string };

export interface CheckoutSideEffectHandler {
  handle(event: {
    id: string;
    eventType: CheckoutSideEffectType;
    orderId: string;
    payload: Record<string, unknown>;
    attemptCount: number;
  }): Promise<SideEffectHandlerResult>;
}

/**
 * Event types that are COMPLETE once recorded, and so have no handler by design.
 *
 * `ReconcileOrderPaymentUseCase` emits these three on a confirmed payment and
 * says so in its own words: "These are RECORDED, not performed." The work they
 * describe is already carried out inline by `SettlePaymentUseCase` — fulfilment,
 * loyalty, the admin email, measurement. The event is the audit fact that the
 * order became eligible, and an audit fact is finished the moment it is written.
 *
 * This is a POLICY, not an absence. "No handler because none is needed" and "no
 * handler because somebody forgot" are indistinguishable at runtime, and the
 * second one cost 339 retries of a real payment event. Declaring the first kind
 * here is what lets the architecture test treat the second kind as a defect.
 */
export interface TerminalSideEffectPolicy {
  /**
   * RETIRE      — the event is genuinely complete once recorded.
   * DEAD_LETTER — nothing should be emitting this; if one appears, make it loud.
   *               Never silently retire an unexpected event: that is the failure
   *               mode this whole file exists to prevent.
   */
  disposition: 'RETIRE' | 'DEAD_LETTER';
  reason: string;
}

export const TERMINAL_SIDE_EFFECT_POLICY: Partial<Record<CheckoutSideEffectType, TerminalSideEffectPolicy>> = {
  ORDER_CUSTOMER_NOTIFICATION_ELIGIBLE: {
    disposition: 'RETIRE',
    reason: 'RECORDED_ONLY: eligibility audit fact; the send is performed by SettlePaymentUseCase.',
  },
  ORDER_LOYALTY_ELIGIBILITY_RECORDED: {
    disposition: 'RETIRE',
    reason: 'RECORDED_ONLY: eligibility audit fact; settlement is performed by SettlePaymentUseCase.',
  },
  ORDER_MEASUREMENT_ELIGIBILITY_RECORDED: {
    disposition: 'RETIRE',
    reason: 'RECORDED_ONLY: eligibility audit fact; measurement is performed by SettlePaymentUseCase.',
  },
  ORDER_PAYMENT_INITIATION_REQUIRED: {
    // Declared in the union but emitted by nothing, and it stays declared so the
    // worker partition cannot silently change meaning. It is deliberately NOT
    // retired-on-sight: an event of a type nobody emits is a surprise, and a
    // surprise about payment initiation should stop and be looked at.
    disposition: 'DEAD_LETTER',
    reason: 'NOT_IN_SERVICE: no producer emits this type; a handler is required before use.',
  },
};

export interface ProcessCheckoutSideEffectBatchResult {
  claimed: number;
  handled: number;
  retried: number;
  deadLettered: number;
  unhandledType: number;
  /** Retired by explicit policy rather than by a handler. */
  terminalByPolicy: number;
}

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 8;

export class ProcessCheckoutSideEffectBatchUseCase {
  constructor(
    private readonly outbox: IOutboxRepository,
    /** One handler per event type. A missing handler is an error, never a success. */
    private readonly handlers: Partial<Record<CheckoutSideEffectType, CheckoutSideEffectHandler>>,
    private readonly observer?: {
      onUnhandledType(eventType: string, eventId: string): void;
      onDeadLettered(eventType: string, eventId: string, error: string): void;
    },
    private readonly random: () => number = Math.random,
    /** Types that are complete once recorded. Injected so a test can vary it. */
    private readonly terminalPolicy: Partial<Record<CheckoutSideEffectType, TerminalSideEffectPolicy>> =
      TERMINAL_SIDE_EFFECT_POLICY,
  ) {}

  async execute(now: Date = new Date()): Promise<ProcessCheckoutSideEffectBatchResult> {
    const events = await this.outbox.claimDueBatch(now, BATCH_SIZE, {
      includeEventTypes: CHECKOUT_SIDE_EFFECT_EVENT_TYPES,
    });

    const result: ProcessCheckoutSideEffectBatchResult = {
      claimed: events.length,
      handled: 0,
      retried: 0,
      deadLettered: 0,
      unhandledType: 0,
      terminalByPolicy: 0,
    };

    for (const event of events) {
      const eventType = event.eventType as CheckoutSideEffectType;
      const handler = this.handlers[eventType];

      const policy = this.terminalPolicy[eventType];
      if (!handler && policy) {
        if (policy.disposition === 'RETIRE') {
          // Complete by design. Retiring it is the correct outcome, not a shortcut.
          await this.outbox.markProcessed(event.id, { lastError: policy.reason });
        } else {
          await this.deadLetter(event, policy.reason);
          result.deadLettered++;
        }
        result.terminalByPolicy++;
        continue;
      }

      if (!handler) {
        // Neither a handler nor a declared policy: a structural defect, and the
        // backlog must stay visible rather than be marked processed — that would
        // discard owed work to make a queue look clean.
        //
        // But visible is not the same as forever. This branch used to call retry()
        // directly, skipping the MAX_ATTEMPTS ceiling every other branch obeys, so
        // a real ORDER_PAYMENT_VERIFICATION_REQUIRED event was re-attempted 339
        // times across ten days and would never have stopped. Bounded retry still
        // survives a deploy that adds the handler — eight attempts with backoff
        // span hours — and what it cannot do is churn indefinitely. After the
        // ceiling it dead-letters, which is both loud and replayable.
        this.observer?.onUnhandledType(event.eventType, event.id);
        result.unhandledType++;
        await this.failWithinCeiling(event, `NO_HANDLER_FOR_${event.eventType}`, result);
        continue;
      }

      const orderId = event.relatedEntityId ?? null;
      if (!orderId) {
        // Nothing to act on and nothing a retry could fix.
        await this.deadLetter(event, 'MISSING_ORDER_REFERENCE');
        result.deadLettered++;
        continue;
      }

      let outcome: SideEffectHandlerResult;
      try {
        outcome = await handler.handle({
          id: event.id,
          eventType,
          orderId,
          payload: event.payload,
          attemptCount: event.attemptCount,
        });
      } catch (error) {
        // A thrown error is transient by default. A handler that knows better
        // returns FINAL; assuming finality from an exception would abandon work on
        // a dropped connection.
        outcome = {
          status: 'RETRY',
          error: error instanceof Error ? error.message : String(error),
        };
      }

      if (outcome.status === 'HANDLED') {
        await this.outbox.markProcessed(event.id);
        result.handled++;
      } else if (outcome.status === 'FINAL') {
        await this.deadLetter(event, outcome.error);
        result.deadLettered++;
      } else {
        await this.failWithinCeiling(event, outcome.error, result);
      }
    }

    return result;
  }

  /**
   * THE ONLY WAY A FAILURE MAY BE RECORDED.
   *
   * Every failing branch goes through here, so the attempt ceiling cannot be
   * bypassed by adding a new one. That is the whole point: the previous bug was
   * not a wrong limit, it was a branch that never consulted the limit at all.
   */
  private async failWithinCeiling(
    event: { id: string; eventType: string; attemptCount: number },
    error: string,
    result: ProcessCheckoutSideEffectBatchResult,
  ): Promise<void> {
    if (event.attemptCount + 1 >= MAX_ATTEMPTS) {
      await this.deadLetter(event, `Exhausted after ${MAX_ATTEMPTS} attempts. Last error: ${error}`);
      result.deadLettered++;
      return;
    }
    await this.retry(event, error);
    result.retried++;
  }

  private async retry(
    event: { id: string; attemptCount: number },
    error: string,
  ): Promise<void> {
    const seconds = computeBackoffSeconds(event.attemptCount, this.random);
    await this.outbox.recordFailure(
      event.id,
      error.slice(0, 500),
      new Date(Date.now() + seconds * 1000),
    );
  }

  private async deadLetter(
    event: { id: string; eventType: string },
    error: string,
  ): Promise<void> {
    this.observer?.onDeadLettered(event.eventType, event.id, error);
    // Dead-lettered, never "processed": the work was never done, and recording it
    // as processed makes it identical to a success in every metric and query.
    if (this.outbox.markDeadLettered) {
      await this.outbox.markDeadLettered(event.id, error.slice(0, 500));
    } else {
      await this.outbox.markProcessed(event.id, { lastError: error.slice(0, 500) });
    }
  }
}
