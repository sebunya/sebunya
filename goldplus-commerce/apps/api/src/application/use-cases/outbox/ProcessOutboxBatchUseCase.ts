import { CHECKOUT_SIDE_EFFECT_EVENT_TYPES } from '../../ports/ICheckoutSideEffectRecorder';
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
  /** Deliveries whose attempt row could not be written. The send still counts. */
  unrecordedAttempts?: number;
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

/** One delivery target of an event: channel, recipient and template. */
export function outboxTargetKey(target: NotificationRoutingTarget): string {
  return `${target.channel}|${target.payload.recipient}|${target.payload.template}`;
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
    // TELEMETRY_DISPATCH is owned by the telemetry dispatcher, which runs in the
    // same tick. This worker also claimed those rows, found no notification
    // route, and retired them as "unroutable": every claim it won was a
    // measurement event silently dropped.
    const events = await this.outboxRepo.claimDueBatch(now, BATCH_SIZE, {
      // AD_CONVERSION (0138) likewise belongs to the advertising dispatcher.
      excludeEventTypes: [...CHECKOUT_SIDE_EFFECT_EVENT_TYPES, 'TELEMETRY_DISPATCH', 'AD_CONVERSION'],
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
      // Hoisted so the crash path below still knows what THIS attempt delivered.
      let sentNow: Set<string> | null = null;
      try {
        // Targets already delivered on an earlier attempt of THIS event. The
        // key is kept on the event itself, so a message delivered to one admin
        // is not sent to them again each time a second address fails.
        const { _sentTargets: priorSent, ...routedPayload } = (event.payload ?? {}) as Record<string, unknown> & { _sentTargets?: unknown };
        const alreadySent = new Set(Array.isArray(priorSent) ? priorSent.map(String) : []);
        const targets = await this.router.route(event.eventType, routedPayload);

        if (targets.length === 0) {
          await this.outboxRepo.markProcessed(event.id, {
            lastError: 'No channel mapping for this event type.',
          });
          result.unroutable++;
          continue;
        }

        let hasSent = false;
        let hopeless = false;
        let hasFailed = false;
        let finalError: string | null = null;
        let allTerminalNonRetryable = true;

        sentNow = new Set(alreadySent);
        for (const target of targets) {
          const targetKey = outboxTargetKey(target);
          if (alreadySent.has(targetKey)) {
            // Delivered on an earlier attempt: counts as sent, is not re-sent.
            hasSent = true;
            allTerminalNonRetryable = false;
            continue;
          }
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

          // A failed attempt WRITE must never turn a delivered message into a
          // retry: that is how one SMS was re-sent 299 times over nine days.
          try {
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
          } catch {
            result.unrecordedAttempts = (result.unrecordedAttempts ?? 0) + 1;
          }

          if (dispatchResult.status === 'SENT') {
            hasSent = true;
            sentNow.add(targetKey);
            allTerminalNonRetryable = false;
          } else if (dispatchResult.status === 'FAILED') {
            hasFailed = true;
            allTerminalNonRetryable = false;
            finalError = dispatchResult.providerMessage;
            // The provider said retrying cannot help. Believe it: production
            // spent 244 attempts re-sending into "Credit exhausted", which both
            // burned the budget and made an account problem look temporary.
            if (dispatchResult.retryable === false) hopeless = true;
          } else {
            // NOT_CONFIGURED or DISABLED
            if (!finalError) {
              finalError = `${dispatchResult.status}: ${dispatchResult.providerMessage}`;
            }
          }
        }

        if (hasFailed) {
          const nextAttemptCount = event.attemptCount + 1;
          if (hopeless) {
            // Dead-lettered on the first answer, with the provider's own reason,
            // so the queue shows what must be FIXED rather than what to wait for.
            const message = `Not retryable: ${finalError}`;
            if (this.outboxRepo.markDeadLettered) {
              await this.outboxRepo.markDeadLettered(event.id, message);
            } else {
              await this.outboxRepo.markProcessed(event.id, { lastError: message });
            }
            result.exhausted++;
          } else if (nextAttemptCount >= MAX_ATTEMPTS) {
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
            await this.outboxRepo.recordFailure(event.id, finalError || 'Unknown fail', nextAttemptAt, {
              sentTargets: [...sentNow],
            });
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
        // Unexpected crash processing one event. It keeps what it already
        // delivered (so a retry does not send it again) and it is bounded like
        // every other failure: without MAX_ATTEMPTS here, a deterministic crash
        // retried — and re-sent — for ever, and never reached the dead-letter list.
        const message = `UNEXPECTED_CRASH: ${fatalErr?.message ?? String(fatalErr)}`;
        if (event.attemptCount + 1 >= MAX_ATTEMPTS) {
          const final = `Exhausted after ${MAX_ATTEMPTS} attempts. Last error: ${message}`;
          if (this.outboxRepo.markDeadLettered) {
            await this.outboxRepo.markDeadLettered(event.id, final);
          } else {
            await this.outboxRepo.markProcessed(event.id, { lastError: final });
          }
          result.exhausted++;
        } else {
          const backoffSeconds = computeBackoffSeconds(event.attemptCount, this.random);
          const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);
          await this.outboxRepo.recordFailure(
            event.id,
            message,
            nextAttemptAt,
            sentNow ? { sentTargets: [...sentNow] } : undefined,
          );
          result.retried++;
        }
      }
    }

    return result;
  }
}
