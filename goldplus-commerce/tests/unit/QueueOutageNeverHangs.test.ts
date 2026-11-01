import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENQUEUE_TIMEOUT_MS,
  QueueService,
  QueueUnavailableError,
  effectiveConcurrency,
  selectReplayableJobs,
} from '../../apps/api/src/infrastructure/queues/QueueService';

/**
 * The ioredis client is built with maxRetriesPerRequest:null and the offline queue
 * on, so with Redis down every enqueue waited forever; getQueue() returned a queue
 * whenever the connection OBJECT existed, so every "queue unavailable" fallback was
 * unreachable, and the outbox ticker's whole tick hung.
 */
function fakeService(status: string, add: () => Promise<unknown>) {
  const qs = Object.create(QueueService.prototype) as QueueService;
  Object.assign(qs as unknown as Record<string, unknown>, {
    redisConnection: { status },
    queues: new Map([['q', { add }]]),
    workers: new Map(),
    manualOverrides: new Map(),
  });
  return qs;
}

const env = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = env;
  vi.useRealTimers();
});

describe('enqueue never waits on a Redis that is not there', () => {
  it('refuses at once when the connection is not ready', async () => {
    process.env.NODE_ENV = 'production';
    const add = vi.fn(() => new Promise(() => undefined));
    const qs = fakeService('reconnecting', add);
    expect(qs.isReady()).toBe(false);
    expect(qs.getReadyQueue('q')).toBeNull();
    await expect(qs.enqueue('q', 'job', {})).rejects.toBeInstanceOf(QueueUnavailableError);
    expect(add).not.toHaveBeenCalled();
  });

  it('gives up after the bound when a ready connection stops answering', async () => {
    process.env.NODE_ENV = 'production';
    vi.useFakeTimers();
    const qs = fakeService('ready', () => new Promise(() => undefined));
    const pending = qs.enqueue('q', 'job', {});
    const assertion = expect(pending).rejects.toMatchObject({ code: 'QUEUE_UNAVAILABLE' });
    await vi.advanceTimersByTimeAsync(ENQUEUE_TIMEOUT_MS + 1);
    await assertion;
  });

  it('the outbox ticker keys on readiness and falls back to inline delivery', () => {
    const ticker = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/scheduler/OutboxTicker.ts'), 'utf8');
    expect(ticker).toContain('let queueUp = qs.isReady();');
    expect(ticker).toContain('err instanceof QueueUnavailableError');
    expect(ticker).not.toContain('!!qs.getQueue(');
  });

  it('request paths do not await the enqueue', () => {
    const root = join(__dirname, '../../apps/api/src');
    expect(readFileSync(join(root, 'application/use-cases/telemetry/TrackBrowserTelemetryEventUseCase.ts'), 'utf8')).toContain('void QueueService.getInstance()');
    expect(readFileSync(join(root, 'infrastructure/db/repositories/DrizzlePaymentRepository.ts'), 'utf8')).toContain('void QueueService.getInstance().enqueue(');
  });
});

describe('an operator concurrency setting survives the backpressure tick', () => {
  it('is a ceiling the monitor only lowers', () => {
    expect(effectiveConcurrency(5, undefined)).toBe(5);
    expect(effectiveConcurrency(5, 1)).toBe(1);
    expect(effectiveConcurrency(1, 3)).toBe(1);
  });

  it('is not reset to 5 on the next tick', () => {
    const qs = fakeService('ready', async () => undefined);
    const worker = { concurrency: 5 };
    (qs as unknown as { workers: Map<string, unknown> }).workers.set('measurement-delivery', worker);
    expect(qs.setWorkerConcurrency('measurement-delivery', 1)).toBe(1);
    qs.adjustConcurrency(10, 5);
    expect(worker.concurrency).toBe(1);
  });
});

describe('replaying failed jobs is bounded', () => {
  const job = (name: string, repeat = false) => ({ name, ...(repeat ? { repeatJobKey: 'k' } : {}) });

  it('skips jobs a repeatable schedule created, filters by name and caps the count', () => {
    const failed = [job('synthetic-cron', true), job('seo-gsc-sync'), job('seo-crawl'), job('seo-gsc-sync')];
    expect(selectReplayableJobs(failed, { jobName: 'seo-gsc-sync' })).toEqual({
      replay: [failed[1], failed[3]],
      skippedRepeatable: 1,
    });
    expect(selectReplayableJobs(failed, { limit: 1 }).replay).toEqual([failed[1]]);
  });

  it('defaults to at most 50', () => {
    const many = Array.from({ length: 80 }, (_, i) => job(`j${i}`));
    expect(selectReplayableJobs(many).replay).toHaveLength(50);
  });
});
