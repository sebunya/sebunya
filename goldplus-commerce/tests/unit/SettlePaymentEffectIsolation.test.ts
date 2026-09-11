import { describe, it, expect } from 'vitest';
import { SettlePaymentUseCase } from '../../apps/api/src/application/use-cases/payments/SettlePaymentUseCase';

/**
 * The money path's effect isolation.
 *
 * Settlement commits BEFORE any effect runs, so no effect can undo a confirmed
 * payment. What is tested here is the other half of the promise the code makes:
 * "one failing must not stop the others". A `.catch()` alone keeps that promise
 * only for a rejected promise — a SYNCHRONOUS throw never creates one.
 */
const build = (effects: Partial<Record<string, unknown>>, log: string[]) =>
  new SettlePaymentUseCase(
    { async execute() { return { ok: true, status: 'completed', amount: 100, currency: 'UGX', orderId: 'o1' }; } } as never,
    { async execute() { return { kind: 'CONFIRMED', orderId: 'o1', stage: 'ORDER_CONFIRMED', reason: 'PAYMENT_CONFIRMED' }; } } as never,
    {
      markFulfilmentPaid: async () => void log.push('fulfilment'),
      settleLoyalty: async () => void log.push('loyalty'),
      enqueueAdminEmail: async () => void log.push('admin_email'),
      recordMeasurement: async () => void log.push('measurement'),
      enqueueCustomerMessage: async () => void log.push('customer_message'),
      onEffectFailed: (effect: string) => void log.push(`REPORTED:${effect}`),
      ...effects,
    } as never,
  );

const run = (settle: SettlePaymentUseCase) =>
  settle.execute({ orderTrackingId: 't1', merchantReference: 'r1', source: 'poll', traceId: 'x' } as never);

describe('SettlePaymentUseCase — post-settlement effect isolation', () => {
  it('runs every effect and confirms when all succeed', async () => {
    const log: string[] = [];
    const result = await run(build({}, log));
    expect(result.confirmed).toBe(true);
    expect(log).toEqual(['fulfilment', 'loyalty', 'admin_email', 'measurement', 'customer_message']);
  });

  it('a REJECTING effect is reported and the rest still run', async () => {
    const log: string[] = [];
    const result = await run(build({ enqueueAdminEmail: async () => { throw new Error('zeptomail 429'); } }, log));
    expect(result.confirmed).toBe(true);
    expect(log).toContain('REPORTED:admin_email');
    expect(log).toContain('measurement');
    expect(log).toContain('customer_message');
  });

  it('a SYNCHRONOUSLY THROWING effect is reported and the rest still run', async () => {
    const log: string[] = [];
    // Not async: throws before any promise exists, so `.catch()` never attaches.
    const result = await run(build({ markFulfilmentPaid: () => { throw new TypeError('sync boom'); } }, log));
    expect(result.confirmed).toBe(true);
    expect(log).toContain('REPORTED:fulfilment_payment_confirmed');
    expect(log).toEqual(expect.arrayContaining(['loyalty', 'admin_email', 'measurement', 'customer_message']));
  });

  it('a MISSING effect method does not abort settlement — the exact integration-double failure', async () => {
    const log: string[] = [];
    const result = await run(build({ enqueueCustomerMessage: undefined }, log));
    expect(result.confirmed).toBe(true);
    expect(log).toContain('REPORTED:customer_message');
    expect(log).toEqual(expect.arrayContaining(['fulfilment', 'loyalty', 'admin_email', 'measurement']));
  });

  it('every effect failing at once still returns a confirmed settlement', async () => {
    const log: string[] = [];
    const boom = () => { throw new Error('everything is down'); };
    const result = await run(build({
      markFulfilmentPaid: boom, settleLoyalty: boom, enqueueAdminEmail: boom,
      recordMeasurement: boom, enqueueCustomerMessage: boom,
    }, log));
    expect(result.confirmed).toBe(true);
    expect(log.filter((l) => l.startsWith('REPORTED:'))).toHaveLength(5);
  });

  it('a throwing REPORTER cannot break the chain it exists to observe', async () => {
    const log: string[] = [];
    const result = await run(build({
      markFulfilmentPaid: () => { throw new Error('boom'); },
      onEffectFailed: () => { throw new Error('the logger is down too'); },
    }, log));
    expect(result.confirmed).toBe(true);
    expect(log).toEqual(expect.arrayContaining(['loyalty', 'admin_email', 'measurement', 'customer_message']));
  });
});
