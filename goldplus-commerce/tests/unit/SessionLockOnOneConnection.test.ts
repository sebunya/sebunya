import { describe, expect, it } from 'vitest';
import { tryAcquireSessionLock, type ReservableSql } from '../../apps/api/src/infrastructure/db/sessionLock';

/**
 * Session advisory locks belong to one backend. Through the pooled client the
 * unlock ran on another connection, returned false, and the lock leaked.
 */
function fakeClient(lockFree: boolean) {
  const log: Array<{ conn: number; query: string }> = [];
  let next = 0;
  let released = 0;
  const client: ReservableSql = {
    async reserve() {
      const conn = ++next;
      return {
        async unsafe(query: string) {
          log.push({ conn, query });
          return [{ ok: query.includes('try') ? lockFree : true }];
        },
        release() { released++; },
      };
    },
  };
  return { client, log, released: () => released };
}

describe('a session lock lives on one reserved connection', () => {
  it('locks and unlocks on the same connection, then returns it to the pool', async () => {
    const f = fakeClient(true);
    const lock = await tryAcquireSessionLock(42, f.client);
    expect(lock).not.toBeNull();
    await lock!.release();
    await lock!.release();
    expect(f.log.map((l) => l.conn)).toEqual([1, 1]);
    expect(f.log[1].query).toContain('pg_advisory_unlock');
    expect(f.released()).toBe(1);
  });

  it('returns null and releases the connection when another holder has it', async () => {
    const f = fakeClient(false);
    expect(await tryAcquireSessionLock(42, f.client)).toBeNull();
    expect(f.released()).toBe(1);
  });
});

describe('payment alerts and the synthetic probe run on one replica per tick', () => {
  it('the ticker takes the ops lock before the non-idempotent part', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const ticker = readFileSync(join(__dirname, '../../apps/api/src/infrastructure/scheduler/PaymentReconcileTicker.ts'), 'utf8');
    const lock = ticker.indexOf('tryAcquireSessionLock(PAYMENT_OPS_LOCK_ID)');
    const probe = ticker.indexOf('pesapalSyntheticProbeUseCase.execute');
    const reconcile = ticker.indexOf('reconcilePendingPaymentsUseCase.execute');
    expect(lock).toBeGreaterThan(reconcile);
    expect(probe).toBeGreaterThan(lock);
    expect(ticker).toContain('if (!opsLock) {');
  });
});
