import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProcessOutboxBatchUseCase, type NotificationRoutingTarget } from '../../apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase';
import type { IOutboxRepository, PersistedOutboxEvent } from '../../apps/api/src/application/ports/IOutboxRepository';
import { RecordNotificationAttemptUseCase } from '../../apps/api/src/application/use-cases/notifications/RecordNotificationAttemptUseCase';

/**
 * RelatedEntityId.ts records one event retried 299 times over nine days, re-sending
 * its SMS before each failed write. The crash path forgot what it had delivered and
 * never dead-lettered, so any throw after a SENT became unbounded customer spam.
 */
const event = (attemptCount: number): PersistedOutboxEvent => ({
  id: 'ev-1',
  eventType: 'CUSTOMER_ORDER_MESSAGE',
  payload: {},
  attemptCount,
  isProcessed: false,
  createdAt: new Date(),
  nextAttemptAt: new Date(Date.now() - 1000),
});

function setup(ev: PersistedOutboxEvent, opts: { attemptSaveThrows?: boolean; markProcessedThrows?: boolean } = {}) {
  const calls = { failure: [] as unknown[][], dead: [] as string[], processed: 0, sent: 0 };
  const outbox: IOutboxRepository = {
    claimDueBatch: async () => [ev],
    markProcessed: async () => {
      if (opts.markProcessedThrows) throw new Error('connection reset');
      calls.processed++;
    },
    recordFailure: async (...args: unknown[]) => { calls.failure.push(args); },
    markDeadLettered: async (_id: string, message: string) => { calls.dead.push(message); },
  } as unknown as IOutboxRepository;
  const target: NotificationRoutingTarget = {
    channel: 'sms',
    provider: { dispatch: async () => { calls.sent++; return { status: 'SENT', providerCode: 'OK', providerMessage: 'ok' }; } },
    payload: { recipient: '+256700000000', template: 'ORDER_CONFIRMED', data: {}, relatedEntity: 'order', relatedEntityId: 'GP-1001' },
  };
  const recorder = new RecordNotificationAttemptUseCase({
    save: async (input: any) => {
      if (opts.attemptSaveThrows) throw new Error('value too long for type character varying(50)');
      return { id: 'a', attemptedAt: new Date(), ...input };
    },
    findRecent: async () => [],
    findByRelatedEntity: async () => [],
  });
  const useCase = new ProcessOutboxBatchUseCase(outbox, { route: async () => [target] }, recorder, () => 0.5);
  return { useCase, calls };
}

describe('a delivered message is never turned into a retry', () => {
  it('a failed attempt-row write still completes the event', async () => {
    const { useCase, calls } = setup(event(0), { attemptSaveThrows: true });
    const result = await useCase.execute();
    expect(calls.sent).toBe(1);
    expect(calls.processed).toBe(1);
    expect(calls.failure).toEqual([]);
    expect(result.unrecordedAttempts).toBe(1);
  });

  it('a crash after a send keeps the delivered target, so the retry skips it', async () => {
    const { useCase, calls } = setup(event(0), { markProcessedThrows: true });
    await useCase.execute();
    expect(calls.failure).toHaveLength(1);
    const opts = calls.failure[0][3] as { sentTargets: string[] };
    expect(opts.sentTargets).toEqual(['sms|+256700000000|ORDER_CONFIRMED']);
  });

  it('the crash path dead-letters at MAX_ATTEMPTS instead of retrying for ever', async () => {
    const { useCase, calls } = setup(event(7), { markProcessedThrows: true });
    const result = await useCase.execute();
    expect(calls.failure).toEqual([]);
    expect(calls.dead[0]).toMatch(/^Exhausted after 8 attempts\. Last error: UNEXPECTED_CRASH: connection reset/);
    expect(result.exhausted).toBe(1);
  });
});

describe('attempt rows fit their columns', () => {
  it('the repository truncates to the column widths and nulls a non-UUID reference', () => {
    const repo = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/db/repositories/DrizzleNotificationAttemptRepository.ts'), 'utf8');
    expect(repo).toContain('providerCode: fit(input.providerCode, 50)');
    expect(repo).toContain('template: fit(input.template, 100)');
    expect(repo).toContain('relatedEntity: fit(input.relatedEntity, 50)');
    expect(repo).toContain('relatedEntityId: toRelatedEntityId(input.relatedEntityId)');
  });
});
