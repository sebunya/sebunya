import { describe, it, expect, vi } from 'vitest';
import { ProcessOutboxBatchUseCase, INotificationRouter, NotificationRoutingTarget } from '../../apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase';
import { IOutboxRepository, PersistedOutboxEvent } from '../../apps/api/src/application/ports/IOutboxRepository';
import { RecordNotificationAttemptUseCase } from '../../apps/api/src/application/use-cases/notifications/RecordNotificationAttemptUseCase';
import { INotificationAttemptRepository } from '../../apps/api/src/application/ports/INotificationAttemptRepository';
import { INotificationProvider, NotificationDispatchResult } from '../../apps/api/src/application/ports/INotificationProvider';

class FakeOutboxRepo implements IOutboxRepository {
  events: PersistedOutboxEvent[] = [];
  processedCallCount = 0;
  failureCallCount = 0;

  async claimDueBatch(now: Date, limit: number): Promise<PersistedOutboxEvent[]> {
    return this.events
      .filter(e => !e.isProcessed && e.nextAttemptAt <= now)
      .slice(0, limit);
  }

  async markProcessed(eventId: string, opts?: { lastError?: string }): Promise<void> {
    this.processedCallCount++;
    const ev = this.events.find(e => e.id === eventId);
    if (ev) {
      ev.isProcessed = true;
    }
  }

  async recordFailure(eventId: string, error: string, nextAttemptAt: Date): Promise<void> {
    this.failureCallCount++;
    const ev = this.events.find(e => e.id === eventId);
    if (ev) {
      ev.attemptCount++;
      ev.nextAttemptAt = nextAttemptAt;
    }
  }
}

class FakeAttemptRepo implements INotificationAttemptRepository {
  savedCount = 0;
  async save(input: any) {
    this.savedCount++;
    return { id: 'a-1', attemptedAt: new Date(), ...input };
  }
  async findRecent() { return []; }
  async findByRelatedEntity() { return []; }
}

describe('ProcessOutboxBatchUseCase', () => {
  const makeEvent = (overrides: Partial<PersistedOutboxEvent> = {}): PersistedOutboxEvent => ({
    id: Math.random().toString(),
    eventType: 'TEST_EVENT',
    payload: { relatedEntityId: '123' },
    attemptCount: 0,
    isProcessed: false,
    createdAt: new Date(),
    nextAttemptAt: new Date(Date.now() - 1000), // in past
    ...overrides
  });

  const setup = (routerResp: NotificationRoutingTarget[]) => {
    const outbox = new FakeOutboxRepo();
    const attemptRepo = new FakeAttemptRepo();
    const recorder = new RecordNotificationAttemptUseCase(attemptRepo);
    
    const router: INotificationRouter = {
      route: async () => routerResp
    };

    const useCase = new ProcessOutboxBatchUseCase(outbox, router, recorder);
    return { useCase, outbox, attemptRepo };
  };

  it('SENT marks event processed and records one attempt', async () => {
    const fakeProvider: INotificationProvider = {
      dispatch: async () => ({ status: 'SENT', providerCode: 'OK', providerMessage: 'Message sent' })
    };
    const { useCase, outbox, attemptRepo } = setup([{
      channel: 'email',
      provider: fakeProvider,
      payload: { recipient: 'x@y.com', template: 'T', data: {}, relatedEntity: 'e', relatedEntityId: '1' }
    }]);

    const ev = makeEvent();
    outbox.events.push(ev);

    const res = await useCase.execute();
    expect(res.succeeded).toBe(1);
    expect(outbox.processedCallCount).toBe(1);
    expect(attemptRepo.savedCount).toBe(1);
    expect(ev.isProcessed).toBe(true);
  });

  it('NOT_CONFIGURED records attempt, marks processed, schedules no retry', async () => {
    const fakeProvider: INotificationProvider = {
      dispatch: async () => ({ status: 'NOT_CONFIGURED', providerCode: 'NO_KEY', providerMessage: 'Misconfigured' })
    };
    const { useCase, outbox, attemptRepo } = setup([{
      channel: 'email',
      provider: fakeProvider,
      payload: { recipient: 'x@y.com', template: 'T', data: {}, relatedEntity: 'e', relatedEntityId: '1' }
    }]);

    const ev = makeEvent();
    outbox.events.push(ev);

    const res = await useCase.execute();
    expect(res.succeeded).toBe(1); // Technically out of queue successfully
    expect(outbox.processedCallCount).toBe(1);
    expect(outbox.failureCallCount).toBe(0);
    expect(attemptRepo.savedCount).toBe(1);
  });

  it('DISABLED records attempt, marks processed, schedules no retry', async () => {
    const fakeProvider: INotificationProvider = {
      dispatch: async () => ({ status: 'DISABLED', providerCode: 'OFF', providerMessage: 'System disabled' })
    };
    const { useCase, outbox } = setup([{
      channel: 'sms',
      provider: fakeProvider,
      payload: { recipient: '123', template: 'T', data: {}, relatedEntity: 'e', relatedEntityId: '1' }
    }]);

    outbox.events.push(makeEvent());
    await useCase.execute();
    expect(outbox.processedCallCount).toBe(1);
    expect(outbox.failureCallCount).toBe(0);
  });

  it('FAILED schedules retry and does not mark processed', async () => {
    const fakeProvider: INotificationProvider = {
      dispatch: async () => ({ status: 'FAILED', providerCode: 'ERR_SERVER', providerMessage: 'Server down' })
    };
    const { useCase, outbox, attemptRepo } = setup([{
      channel: 'email',
      provider: fakeProvider,
      payload: { recipient: 'x@y.com', template: 'T', data: {}, relatedEntity: 'e', relatedEntityId: '1' }
    }]);

    const ev = makeEvent({ attemptCount: 0 });
    outbox.events.push(ev);

    const res = await useCase.execute();
    expect(res.retried).toBe(1);
    expect(outbox.processedCallCount).toBe(0);
    expect(outbox.failureCallCount).toBe(1);
    expect(attemptRepo.savedCount).toBe(1);
    // Verify attempt incremented in repo tracker
    expect(ev.attemptCount).toBe(1);
  });

  it('FAILED at attemptCount 7 exhausts at max 8 and marks processed', async () => {
    const fakeProvider: INotificationProvider = {
      dispatch: async () => ({ status: 'FAILED', providerCode: 'ERR', providerMessage: 'Fatal' })
    };
    const { useCase, outbox } = setup([{
      channel: 'email',
      provider: fakeProvider,
      payload: { recipient: 'x@y.com', template: 'T', data: {}, relatedEntity: 'e', relatedEntityId: '1' }
    }]);

    // Starts at 7th attempt (0-indexed count implies 7 failed previously, next increment would be 8 total attempts)
    // Logic in usecase: nextAttemptCount = attemptCount + 1 = 8. Since 8 >= 8, it exhausts.
    const ev = makeEvent({ attemptCount: 7 });
    outbox.events.push(ev);

    const res = await useCase.execute();
    expect(res.exhausted).toBe(1);
    expect(outbox.processedCallCount).toBe(1);
    expect(outbox.failureCallCount).toBe(0);
    expect(ev.isProcessed).toBe(true);
  });

  it('Unknown/unroutable event marks processed without notification attempt', async () => {
    const { useCase, outbox, attemptRepo } = setup([]); // Empty router response

    outbox.events.push(makeEvent());

    const res = await useCase.execute();
    expect(res.unroutable).toBe(1);
    expect(outbox.processedCallCount).toBe(1);
    expect(attemptRepo.savedCount).toBe(0);
  });

  it('Adapter throw becomes FAILED with providerCode ADAPTER_THREW and schedules retry', async () => {
    const fakeProvider: INotificationProvider = {
      dispatch: async () => { throw new Error('Socket explosion'); }
    };
    const { useCase, outbox, attemptRepo } = setup([{
      channel: 'email',
      provider: fakeProvider,
      payload: { recipient: 'x@y.com', template: 'T', data: {}, relatedEntity: 'e', relatedEntityId: '1' }
    }]);

    outbox.events.push(makeEvent());

    const res = await useCase.execute();
    expect(res.retried).toBe(1);
    expect(attemptRepo.savedCount).toBe(1);
  });

  it('Empty batch returns zero counts', async () => {
    const { useCase } = setup([]);
    const res = await useCase.execute();
    expect(res.claimed).toBe(0);
    expect(res.succeeded).toBe(0);
  });

  it('Backoff grows and respects cap', async () => {
    const fakeProvider: INotificationProvider = {
      dispatch: async () => ({ status: 'FAILED', providerCode: 'ERR', providerMessage: 'Bad' })
    };
    const { useCase, outbox } = setup([{
      channel: 'email',
      provider: fakeProvider,
      payload: { recipient: 'x@y.com', template: 'T', data: {}, relatedEntity: 'e', relatedEntityId: '1' }
    }]);

    // Mock time to anchor the nextAttemptAt
    const baseTime = 1000000000000; // static timestamp
    vi.useFakeTimers();
    vi.setSystemTime(new Date(baseTime));

    // Backoff now carries equal jitter so a backlog that failed together does not
    // retry in one instant, so the delay is a RANGE rather than a fixed value:
    // cap/2 <= delay <= cap. The growth and cap guarantees are unchanged.

    // attemptCount=0 -> cap = 60 * 2^0 = 60s -> delay in [30s, 60s]
    const ev1 = makeEvent({ id: '1', attemptCount: 0 });
    outbox.events.push(ev1);
    await useCase.execute();
    const delay1 = ev1.nextAttemptAt.getTime() - baseTime;
    expect(delay1).toBeGreaterThanOrEqual(30 * 1000);
    expect(delay1).toBeLessThanOrEqual(60 * 1000);

    // attemptCount=6 -> 60 * 2^6 = 3840s, capped at 3600s -> delay in [1800s, 3600s]
    const ev2 = makeEvent({ id: '2', attemptCount: 6 });
    outbox.events.push(ev2);
    await useCase.execute();
    const delay2 = ev2.nextAttemptAt.getTime() - baseTime;
    expect(delay2).toBeGreaterThanOrEqual(1800 * 1000);
    expect(delay2).toBeLessThanOrEqual(3600 * 1000);

    // The cap must still bind: a later attempt cannot exceed one hour.
    expect(delay2).toBeLessThanOrEqual(3600 * 1000);

    vi.useRealTimers();
  });
});
