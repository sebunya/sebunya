import { describe, it, expect } from 'vitest';
import {
  ProcessCheckoutSideEffectBatchUseCase,
  type SideEffectHandlerResult,
} from '../../apps/api/src/application/use-cases/outbox/ProcessCheckoutSideEffectBatchUseCase';
import type {
  IOutboxRepository,
  OutboxClaimFilter,
  PersistedOutboxEvent,
} from '../../apps/api/src/application/ports/IOutboxRepository';
import { CHECKOUT_SIDE_EFFECT_EVENT_TYPES } from '../../apps/api/src/application/ports/ICheckoutSideEffectRecorder';

/**
 * The consumer half of durable side effects.
 *
 * Recording an intent is only half the guarantee. If nothing performs the queued
 * work, an order accumulates a perfect audit trail of tasks that never happen —
 * which is worse than the original bug, because the record says the work is owed
 * and no operator is told it never ran.
 *
 * The behaviour that matters here is what happens when work FAILS: an event must
 * never be retired unless it was actually handled. Marking a failure "processed"
 * is what made the previous unroutable path silently discard commerce work.
 */

const event = (over: Partial<PersistedOutboxEvent> = {}): PersistedOutboxEvent => ({
  id: 'evt-1',
  eventType: 'ORDER_FULFILMENT_REQUIRED',
  payload: { hold: false, warnings: [] },
  attemptCount: 0,
  isProcessed: false,
  createdAt: new Date(),
  nextAttemptAt: new Date(),
  status: 'processing',
  relatedEntity: 'order',
  relatedEntityId: 'order-1',
  dryRunOnly: false,
  previewOnly: false,
  noSendGuarantee: false,
  ...over,
});

interface Trace {
  processed: string[];
  failures: Array<{ id: string; error: string }>;
  deadLettered: Array<{ id: string; error: string }>;
  handled: string[];
  claimFilters: Array<OutboxClaimFilter | undefined>;
}

function build(opts: {
  events?: PersistedOutboxEvent[];
  result?: SideEffectHandlerResult;
  handlerThrows?: Error;
  withoutHandler?: boolean;
} = {}) {
  const trace: Trace = {
    processed: [], failures: [], deadLettered: [], handled: [], claimFilters: [],
  };

  const outbox = {
    claimDueBatch: async (_now: Date, _limit: number, filter?: OutboxClaimFilter) => {
      trace.claimFilters.push(filter);
      return opts.events ?? [event()];
    },
    markProcessed: async (id: string) => { trace.processed.push(id); return true; },
    recordFailure: async (id: string, error: string) => { trace.failures.push({ id, error }); return true; },
    markDeadLettered: async (id: string, error: string) => {
      trace.deadLettered.push({ id, error });
      return true;
    },
  } as unknown as IOutboxRepository;

  const handler = {
    handle: async (e: { id: string }) => {
      if (opts.handlerThrows) throw opts.handlerThrows;
      trace.handled.push(e.id);
      return opts.result ?? ({ status: 'HANDLED' } as SideEffectHandlerResult);
    },
  };

  const useCase = new ProcessCheckoutSideEffectBatchUseCase(
    outbox,
    opts.withoutHandler ? {} : { ORDER_FULFILMENT_REQUIRED: handler },
    undefined,
    () => 0.5,
  );

  return { useCase, trace };
}

describe('claiming is partitioned by event type', () => {
  it('claims only commerce-work events', async () => {
    // Sharing the claim with the notification worker is what let it take these
    // events, find no channel mapping, and retire them as "unroutable".
    const { useCase, trace } = build();
    await useCase.execute();
    expect(trace.claimFilters[0]?.includeEventTypes).toEqual(CHECKOUT_SIDE_EFFECT_EVENT_TYPES);
  });
});

describe('handled work is retired exactly once', () => {
  it('marks the event processed', async () => {
    const { useCase, trace } = build();
    const result = await useCase.execute();
    expect(trace.handled).toEqual(['evt-1']);
    expect(trace.processed).toEqual(['evt-1']);
    expect(result.handled).toBe(1);
  });
});

describe('failed work is never retired as processed', () => {
  it('retries a transient failure with backoff instead of marking it processed', async () => {
    const { useCase, trace } = build({ result: { status: 'RETRY', error: 'db down' } });
    const result = await useCase.execute();

    expect(trace.processed).toEqual([]);
    expect(trace.failures[0].error).toBe('db down');
    expect(result.retried).toBe(1);
  });

  it('treats a thrown error as transient rather than assuming finality', async () => {
    // A dropped connection must not abandon work the customer's order needs.
    const { useCase, trace } = build({ handlerThrows: new Error('ECONNRESET') });
    const result = await useCase.execute();

    expect(trace.deadLettered).toEqual([]);
    expect(result.retried).toBe(1);
  });

  it('dead-letters a final failure instead of burning every attempt', async () => {
    const { useCase, trace } = build({ result: { status: 'FINAL', error: 'ORDER_NOT_FOUND' } });
    const result = await useCase.execute();

    expect(trace.processed).toEqual([]);
    expect(trace.deadLettered[0].error).toBe('ORDER_NOT_FOUND');
    expect(result.deadLettered).toBe(1);
  });

  it('dead-letters rather than retrying forever once attempts are exhausted', async () => {
    const { useCase, trace } = build({
      events: [event({ attemptCount: 7 })],
      result: { status: 'RETRY', error: 'still down' },
    });
    await useCase.execute();
    expect(trace.deadLettered[0].error).toContain('Exhausted after 8 attempts');
    expect(trace.processed).toEqual([]);
  });
});

describe('an event with no handler is kept, not discarded', () => {
  it('retries rather than marking it processed', async () => {
    // Retiring it would discard owed work to make the queue look clean, and the
    // event must survive until a deploy adds the handler.
    const { useCase, trace } = build({ withoutHandler: true });
    const result = await useCase.execute();

    expect(trace.processed).toEqual([]);
    expect(trace.failures[0].error).toContain('NO_HANDLER_FOR_ORDER_FULFILMENT_REQUIRED');
    expect(result.unhandledType).toBe(1);
  });
});

describe('an event that names no order cannot be acted on', () => {
  it('dead-letters instead of retrying something no wait can fix', async () => {
    const { useCase, trace } = build({ events: [event({ relatedEntityId: null })] });
    const result = await useCase.execute();

    expect(trace.deadLettered[0].error).toBe('MISSING_ORDER_REFERENCE');
    expect(trace.handled).toEqual([]);
    expect(result.deadLettered).toBe(1);
  });
});
