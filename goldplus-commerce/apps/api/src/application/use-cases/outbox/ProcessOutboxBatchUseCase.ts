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

export class ProcessOutboxBatchUseCase {
  constructor(
    private readonly outboxRepo: IOutboxRepository,
    private readonly router: INotificationRouter,
    private readonly recordAttempt: RecordNotificationAttemptUseCase
  ) {}

  async execute(): Promise<ProcessOutboxBatchResult> {
    const now = new Date();
    const events = await this.outboxRepo.claimDueBatch(now, BATCH_SIZE);

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
            await this.outboxRepo.markProcessed(event.id, {
              lastError: `Exhausted after ${MAX_ATTEMPTS} attempts. Last error: ${finalError}`,
            });
            result.exhausted++;
          } else {
            const backoffSeconds = Math.min(
              BACKOFF_BASE_SECONDS * Math.pow(2, event.attemptCount), // Uses current attempt count for 60s, 120s, 240s...
              MAX_BACKOFF_SECONDS
            );
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
        const backoffSeconds = Math.min(BACKOFF_BASE_SECONDS * Math.pow(2, event.attemptCount), MAX_BACKOFF_SECONDS);
        const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);
        await this.outboxRepo.recordFailure(event.id, `UNEXPECTED_CRASH: ${fatalErr.message}`, nextAttemptAt);
        result.retried++;
      }
    }

    return result;
  }
}
