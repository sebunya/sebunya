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

export interface ProcessCheckoutSideEffectBatchResult {
  claimed: number;
  handled: number;
  retried: number;
  deadLettered: number;
  unhandledType: number;
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
    };

    for (const event of events) {
      const eventType = event.eventType as CheckoutSideEffectType;
      const handler = this.handlers[eventType];

      if (!handler) {
        // Left claimed-and-failing on purpose. Marking it processed would discard
        // owed work to make a queue look clean; this way the backlog is visible
        // and the event survives a deploy that adds the handler.
        this.observer?.onUnhandledType(event.eventType, event.id);
        await this.retry(event, `NO_HANDLER_FOR_${event.eventType}`);
        result.unhandledType++;
        result.retried++;
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
      } else if (event.attemptCount + 1 >= MAX_ATTEMPTS) {
        await this.deadLetter(
          event,
          `Exhausted after ${MAX_ATTEMPTS} attempts. Last error: ${outcome.error}`,
        );
        result.deadLettered++;
      } else {
        await this.retry(event, outcome.error);
        result.retried++;
      }
    }

    return result;
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
