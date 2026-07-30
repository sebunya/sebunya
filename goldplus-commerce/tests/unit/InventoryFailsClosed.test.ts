import { describe, it, expect, vi } from 'vitest';
import {
  summariseReservation,
  reservationStateFor,
  mayProgressToPayment,
  mayCreateFulfilment,
  isRetryableDatabaseError,
  parseInventoryPolicy,
  DEFAULT_INVENTORY_POLICY,
  type ReservationLineOutcome,
} from '../../apps/api/src/domain/inventory/Inventory';
import { withTransactionRetry } from '../../apps/api/src/infrastructure/db/repositories/DrizzleInventoryRepository';
import {
  ReserveInventoryForOrderUseCase,
  type ReservationAlert,
} from '../../apps/api/src/application/use-cases/inventory/ReserveInventoryForOrderUseCase';

/**
 * Reservation used to be best-effort: every exception from the repository was
 * caught by the checkout route and turned into an ON_HOLD backorder. A deadlock,
 * a statement timeout, a dropped connection and a genuine stock shortage all
 * produced the same outcome, so the order was recorded as backordered while the
 * same units stayed available to the next customer.
 */

const line = (over: Partial<ReservationLineOutcome> = {}): ReservationLineOutcome => ({
  productId: 'p1',
  requested: 2,
  reserved: 2,
  shortfall: 0,
  policy: 'STOCK_CONTROLLED',
  ...over,
});

describe('inventory policy', () => {
  it('treats anything unclassified as stock-controlled', () => {
    // The safe reading of an unknown product is that it must be reserved.
    for (const raw of [undefined, null, '', 'whatever', 'backorder_allowed']) {
      expect(parseInventoryPolicy(raw)).toBe('STOCK_CONTROLLED');
    }
    expect(DEFAULT_INVENTORY_POLICY).toBe('STOCK_CONTROLLED');
  });

  it('accepts only the three defined policies', () => {
    expect(parseInventoryPolicy('BACKORDER_ALLOWED')).toBe('BACKORDER_ALLOWED');
    expect(parseInventoryPolicy('NON_STOCK_ITEM')).toBe('NON_STOCK_ITEM');
  });
});

describe('outcome classification', () => {
  it('reports RESERVED when every line is held', () => {
    expect(summariseReservation('o1', [line()]).code).toBe('RESERVED');
  });

  it('distinguishes a replay as ALREADY_RESERVED', () => {
    expect(summariseReservation('o1', [line()], true).code).toBe('ALREADY_RESERVED');
  });

  it('blocks the order when a STOCK_CONTROLLED line is short', () => {
    const outcome = summariseReservation('o1', [line({ reserved: 0, shortfall: 2 })]);
    expect(outcome.code).toBe('INSUFFICIENT_STOCK');
    expect(outcome.state).toBe('UNRESERVED_BLOCKED');
    expect(mayProgressToPayment(outcome.state)).toBe(false);
    expect(mayCreateFulfilment(outcome.state)).toBe(false);
  });

  it('allows BACKORDERED only when every short line permits it', () => {
    const outcome = summariseReservation('o1', [
      line({ productId: 'a', reserved: 0, shortfall: 2, policy: 'BACKORDER_ALLOWED' }),
    ]);
    expect(outcome.code).toBe('BACKORDERED');
    expect(mayProgressToPayment(outcome.state)).toBe(true);
  });

  it('one stock-controlled short line blocks an otherwise backorderable order', () => {
    const outcome = summariseReservation('o1', [
      line({ productId: 'a', reserved: 0, shortfall: 1, policy: 'BACKORDER_ALLOWED' }),
      line({ productId: 'b', reserved: 0, shortfall: 1, policy: 'STOCK_CONTROLLED' }),
    ]);
    expect(outcome.code).toBe('INSUFFICIENT_STOCK');
    expect(outcome.warnings.some((w) => w.includes('cannot be sold short'))).toBe(true);
  });

  it('never maps a technical failure onto a backorder', () => {
    // The whole point: these two are different facts about the world.
    expect(reservationStateFor('RETRYABLE_FAILURE')).toBe('UNRESERVED_BLOCKED');
    expect(reservationStateFor('TERMINAL_FAILURE')).toBe('UNRESERVED_BLOCKED');
    expect(reservationStateFor('BACKORDERED')).toBe('BACKORDERED');
  });

  it('fails closed on PENDING — "not looked at yet" is not "probably fine"', () => {
    expect(mayProgressToPayment('PENDING')).toBe(false);
    expect(mayCreateFulfilment('PENDING')).toBe(false);
  });
});

describe('retryable classification', () => {
  it('treats deadlock, serialization failure and timeouts as retryable', () => {
    for (const code of ['40001', '40P01', '55P03', '57014', '08006', '53300']) {
      expect(isRetryableDatabaseError({ code })).toBe(true);
    }
    expect(isRetryableDatabaseError({ code: 'ECONNRESET' })).toBe(true);
  });

  it('does not retry errors that will fail identically forever', () => {
    // A constraint violation retried three times is three identical failures
    // and a delayed truthful answer.
    for (const code of ['23505', '23514', '42601', '42703', undefined]) {
      expect(isRetryableDatabaseError({ code })).toBe(false);
    }
    expect(isRetryableDatabaseError(new Error('boom'))).toBe(false);
  });
});

describe('bounded transaction retry', () => {
  const noSleep = () => Promise.resolve();

  it('succeeds on a second attempt after a serialization failure', async () => {
    let calls = 0;
    const result = await withTransactionRetry(
      async () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('serialization'), { code: '40001' });
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('gives up after the bound rather than retrying forever', async () => {
    let calls = 0;
    await expect(
      withTransactionRetry(
        async () => {
          calls++;
          throw Object.assign(new Error('deadlock'), { code: '40P01' });
        },
        { sleep: noSleep, maxAttempts: 3 },
      ),
    ).rejects.toThrow('deadlock');
    expect(calls).toBe(3);
  });

  it('reports retry exhaustion so it can be alerted on', async () => {
    const exhausted = vi.fn();
    await expect(
      withTransactionRetry(
        async () => {
          throw Object.assign(new Error('deadlock'), { code: '40P01' });
        },
        { sleep: noSleep, maxAttempts: 2, onExhausted: exhausted },
      ),
    ).rejects.toThrow();
    expect(exhausted).toHaveBeenCalledOnce();
  });

  it('does not retry a terminal error at all', async () => {
    let calls = 0;
    await expect(
      withTransactionRetry(
        async () => {
          calls++;
          throw Object.assign(new Error('unique violation'), { code: '23505' });
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('jitters the delay so two deadlocked transactions do not retry in step', async () => {
    const delays: number[] = [];
    const collect = async (ms: number) => {
      delays.push(ms);
    };
    for (let i = 0; i < 30; i++) {
      let first = true;
      await withTransactionRetry(
        async () => {
          if (first) {
            first = false;
            throw Object.assign(new Error('d'), { code: '40P01' });
          }
          return 1;
        },
        { sleep: collect },
      );
    }
    expect(new Set(delays).size).toBeGreaterThan(3);
  });
});

describe('reservation use case compensation', () => {
  const order = { id: 'o1', items: [{ productId: 'p1', quantity: 2 }] } as never;

  const useCaseWith = (
    reserveForOrder: () => Promise<never> | Promise<unknown>,
    alerts: ReservationAlert[] = [],
    states: string[] = [],
  ) =>
    new ReserveInventoryForOrderUseCase({
      repo: { reserveForOrder } as never,
      orderState: {
        setReservationState: async (_id: string, s: string) => {
          states.push(s);
        },
      } as never,
      onAlert: (a) => {
        alerts.push(a);
      },
    });

  it('records UNRESERVED_BLOCKED and alerts when the database fails', async () => {
    const alerts: ReservationAlert[] = [];
    const states: string[] = [];
    const useCase = useCaseWith(
      () => Promise.reject(Object.assign(new Error('deadlock'), { code: '40P01' })),
      alerts,
      states,
    );

    const outcome = await useCase.execute(order);

    expect(outcome.code).toBe('RETRYABLE_FAILURE');
    expect(outcome.state).toBe('UNRESERVED_BLOCKED');
    expect(states).toEqual(['UNRESERVED_BLOCKED']);
    expect(alerts[0].code).toBe('RETRYABLE_FAILURE');
  });

  it('classifies a non-transient error as TERMINAL_FAILURE', async () => {
    const useCase = useCaseWith(() => Promise.reject(new Error('column does not exist')));
    const outcome = await useCase.execute(order);
    expect(outcome.code).toBe('TERMINAL_FAILURE');
    expect(mayProgressToPayment(outcome.state)).toBe(false);
  });

  it('does not throw — the order already exists and must not be abandoned', async () => {
    const useCase = useCaseWith(() => Promise.reject(new Error('boom')));
    await expect(useCase.execute(order)).resolves.toBeDefined();
  });

  it('warns truthfully rather than calling a failure a backorder', async () => {
    const useCase = useCaseWith(() => Promise.reject(new Error('boom')));
    const outcome = await useCase.execute(order);
    expect(outcome.warnings.join(' ')).toContain('STOCK_NOT_CONFIRMED');
    expect(outcome.warnings.join(' ')).not.toMatch(/^Backorder:/);
  });

  it('alerts when a stock-controlled line is genuinely short', async () => {
    const alerts: ReservationAlert[] = [];
    const useCase = useCaseWith(
      async () => summariseReservation('o1', [line({ reserved: 0, shortfall: 2 })]),
      alerts,
    );
    const outcome = await useCase.execute(order);
    expect(outcome.code).toBe('INSUFFICIENT_STOCK');
    expect(alerts[0].code).toBe('INSUFFICIENT_STOCK');
  });

  it('leaves the order un-progressable when the state cannot be recorded', async () => {
    const alerts: ReservationAlert[] = [];
    const useCase = new ReserveInventoryForOrderUseCase({
      repo: { reserveForOrder: async () => summariseReservation('o1', [line()]) } as never,
      orderState: {
        setReservationState: async () => {
          throw new Error('write failed');
        },
      } as never,
      onAlert: (a) => {
        alerts.push(a);
      },
    });
    await useCase.execute(order);
    // The order stays PENDING in the database, which fails closed.
    expect(alerts.some((a) => a.detail.includes('could not be recorded'))).toBe(true);
  });

  it('an alerting failure never masks the reservation outcome', async () => {
    const useCase = new ReserveInventoryForOrderUseCase({
      repo: { reserveForOrder: async () => summariseReservation('o1', [line()]) } as never,
      onAlert: () => {
        throw new Error('pager down');
      },
    });
    await expect(useCase.execute(order)).resolves.toMatchObject({ code: 'RESERVED' });
  });
});

describe('checkout route contract', () => {
  const source = new URL('../../apps/api/src/interfaces/http/routes/commerce.ts', import.meta.url);

  it('no longer swallows reservation errors into a hold', async () => {
    const text = await (await import('node:fs/promises')).readFile(source, 'utf8');
    const start = text.indexOf('const reservation = await registry.reserveInventoryForOrderUseCase');
    expect(start).toBeGreaterThan(-1);
    const window = text.slice(start - 400, start + 200);
    expect(window).not.toContain('catch (invErr');
    // Renamed to one canonical decision object; `stockHeld = !fullyReserved` was
    // an inverse name that forced every branch to be re-derived by negation.
    expect(text).toContain('decision.mayCreateFulfilment');
    expect(text).not.toMatch(/const stockHeld =/);
    expect(text).toContain("code: 'STOCK_NOT_RESERVED'");
  });
});
