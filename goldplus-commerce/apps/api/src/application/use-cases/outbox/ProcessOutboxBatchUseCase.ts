import { CHECKOUT_SIDE_EFFECT_EVENT_TYPES } from '../../ports/ICheckoutSideEffectRecorder';
import { PASSWORD_RESET_DELIVERY_EVENT_TYPE } from '../../ports/IPasswordResetDelivery';
import { IOutboxRepository } from '../../ports/IOutboxRepository';
import { INotificationProvider, NotificationDispatchPayload, NotificationStatus } from '../../ports/INotificationProvider';
import { RecordNotificationAttemptUseCase } from '../notifications/RecordNotificationAttemptUseCase';

export interface NotificationRoutingTarget {
  channel: string;
  provider: INotificationProvider;
  payload: NotificationDispatchPayload;
}

export interface INotificationRouter {
  route(eventType: string, payload: Record<string, unknown>): Promise<NotificationRoutingTarget[]>;
}

export interface ProcessOutboxBatchResult {
  claimed: number;
  succeeded: number;
  retried: number;
  exhausted: number;
  unroutable: number;
}

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 8;
const BACKOFF_BASE_SECONDS = 60;
const MAX_BACKOFF_SECONDS = 3600; // Capped at 1 hour

/**
 * Retry delay with equal jitter.
 *
 * The previous schedule was purely deterministic — 60s, 120s, 240s … — so every
 * event that failed during the same incident retried at the same instant. When a
 * dependency comes back after an outage the whole backlog lands on it
 * simultaneously and can knock it straight over again, which is exactly the
 * thundering herd retries are supposed to prevent.
 *
 * Equal jitter keeps half the delay deterministic and randomises the other half:
 *
 *   delay = cap/2 + random(0, cap/2)
 *
 * Full jitter (random across the whole window) spreads slightly better but can
 * retry almost immediately, which for an outbox means hammering a service that is
 * still failing. Keeping a floor of half the backoff preserves the intended
 * minimum wait while still spreading the herd across the window.
 *
 * `random` is injected so the schedule is deterministically testable.
 */
export function computeBackoffSeconds(
  attemptCount: number,
  random: () => number = Math.random,
): number {
  const uncapped = BACKOFF_BASE_SECONDS * Math.pow(2, attemptCount);
  const cap = Math.min(uncapped, MAX_BACKOFF_SECONDS);
  const half = cap / 2;
  return Math.round(half + random() * half);
}

export class ProcessOutboxBatchUseCase {
  constructor(
    private readonly outboxRepo: IOutboxRepository,
    private readonly router: INotificationRouter,
    private readonly recordAttempt: RecordNotificationAttemptUseCase,
    /** Injected so the retry schedule is deterministically testable. */
    private readonly random: () => number = Math.random,
  ) {}

  async execute(): Promise<ProcessOutboxBatchResult> {
    const now = new Date();
    // Commerce-work events are excluded. This worker routes an event to a
    // notification provider; those events have no channel and no recipient, so it
    // would find no route, mark them processed as "unroutable", and report success
    // while the fulfilment task the order depends on was discarded.
    // `ProcessCheckoutSideEffectBatchUseCase` claims them instead.
    //
    // Password-reset delivery is excluded for the same reason and a sharper
    // one: at retry time the credential does not exist yet, so there is no
    // recipient payload to route. Claimed here it would be found unroutable and
    // marked processed — silently destroying a customer's reset delivery. Its
    // own processor mints the token first, then sends.
    const events = await this.outboxRepo.claimDueBatch(now, BATCH_SIZE, {
      excludeEventTypes: [...CHECKOUT_SIDE_EFFECT_EVENT_TYPES, PASSWORD_RESET_DELIVERY_EVENT_TYPE],
    });

    const result: ProcessOutboxBatchResult = {
      claimed: events.length,
      succeeded: 0,
      retried: 0,
      exhausted: 0,
      unroutable: 0,
    };

    if (events.length === 0) {
      return result;
    }

    for (const event of events) {
      try {
        const targets = await this.router.route(event.eventType, event.payload);

        if (targets.length === 0) {
          await this.outboxRepo.markProcessed(event.id, {
            lastError: 'No channel mapping for this event type.',
          });
          result.unroutable++;
          continue;
        }

        let hasSent = false;
        let hasFailed = false;
        let finalError: string | null = null;
        let allTerminalNonRetryable = true;

        for (const target of targets) {
          let dispatchResult;
          try {
            dispatchResult = await target.provider.dispatch(target.payload);
          } catch (err: any) {
            dispatchResult = {
              status: 'FAILED' as NotificationStatus,
              providerCode: 'ADAPTER_THREW',
              providerMessage: err.message || 'Unknown error during adapter dispatch.',
            };
          }

          await this.recordAttempt.execute({
            channel: target.channel,
            recipient: target.payload.recipient,
            template: target.payload.template,
            status: dispatchResult.status,
            providerCode: dispatchResult.providerCode,
            providerMessage: dispatchResult.providerMessage,
            relatedEntity: target.payload.relatedEntity,
            relatedEntityId: target.payload.relatedEntityId,
          });

          if (dispatchResult.status === 'SENT') {
            hasSent = true;
            allTerminalNonRetryable = false;
          } else if (dispatchResult.status === 'FAILED') {
            hasFailed = true;
            allTerminalNonRetryable = false;
            finalError = dispatchResult.providerMessage;
          } else {
            // NOT_CONFIGURED or DISABLED
            if (!finalError) {
              finalError = `${dispatchResult.status}: ${dispatchResult.providerMessage}`;
            }
          }
        }

        if (hasFailed) {
          const nextAttemptCount = event.attemptCount + 1;
          if (nextAttemptCount >= MAX_ATTEMPTS) {
            // Dead-letter, not "processed". An exhausted event was never
            // delivered, and recording it as processed made it identical to a
            // success in every metric and query — the failures were invisible.
            const message = `Exhausted after ${MAX_ATTEMPTS} attempts. Last error: ${finalError}`;
            if (this.outboxRepo.markDeadLettered) {
              await this.outboxRepo.markDeadLettered(event.id, message);
            } else {
              await this.outboxRepo.markProcessed(event.id, { lastError: message });
            }
            result.exhausted++;
          } else {
            const backoffSeconds = computeBackoffSeconds(event.attemptCount, this.random);
            const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);
            await this.outboxRepo.recordFailure(event.id, finalError || 'Unknown fail', nextAttemptAt);
            result.retried++;
          }
        } else if (allTerminalNonRetryable) {
          await this.outboxRepo.markProcessed(event.id, {
            lastError: finalError || 'All targets reported terminal non-retryable.',
          });
          result.succeeded++; // Technically processed out of the queue correctly
        } else {
          // No failures and at least one success or not_configured/disabled
          await this.outboxRepo.markProcessed(event.id);
          result.succeeded++;
        }

      } catch (fatalErr: any) {
        // Unexpected crash processing single item, increment counter and retry normally
        const backoffSeconds = computeBackoffSeconds(event.attemptCount, this.random);
        const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);
        await this.outboxRepo.recordFailure(event.id, `UNEXPECTED_CRASH: ${fatalErr.message}`, nextAttemptAt);
        result.retried++;
      }
    }

    return result;
  }
}
