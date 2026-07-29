import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Two defects in the database client.
 *
 * The deadlock/serialization retry sat INSIDE the begin() callback, re-running
 * the caller's function on the same handle. Verified against a real PostgreSQL
 * 16 not to work: once any statement errors inside a transaction, the
 * transaction is aborted and every subsequent statement fails with 25P02
 * "current transaction is aborted". The retry burned all three attempts, added
 * latency and surfaced a more confusing error than the original — during exactly
 * the contention incidents it existed to smooth over.
 *
 * And the slow-query log wrote the bound parameter VALUES. A slow query is very
 * often a customer lookup, so those are the customer's email, phone, name or
 * address, copied into log storage retained far longer than the request.
 */
const source = readFileSync(
  join(__dirname, '../../apps/api/src/infrastructure/db/client.ts'),
  'utf8',
);

const beginBlock = source.slice(source.indexOf('const originalBegin'), source.indexOf('export const db = drizzle'));

describe('transaction retry restarts the transaction', () => {
  it('retries around originalBegin, not inside the callback', () => {
    // The loop must enclose the call that OPENS the transaction.
    const loop = beginBlock.indexOf('for (let attempt');
    const runOnce = beginBlock.indexOf('await runOnce()');
    expect(loop).toBeGreaterThan(-1);
    expect(runOnce).toBeGreaterThan(loop);
  });

  it('does not re-invoke the caller inside a single transaction', () => {
    // `callback` is handed to originalBegin once per attempt and never called
    // directly, which is what made the old loop run against an aborted handle.
    expect(beginBlock).not.toMatch(/await\s+callback\(/);
  });

  it('retries only genuinely transient codes', () => {
    expect(beginBlock).toContain("'40001'");
    expect(beginBlock).toContain("'40P01'");
    // A constraint violation retried three times is three identical failures.
    expect(beginBlock).not.toContain("'23505'");
  });

  it('bounds the attempts', () => {
    expect(beginBlock).toContain('MAX_TX_ATTEMPTS');
    expect(source).toMatch(/MAX_TX_ATTEMPTS\s*=\s*3/);
  });

  it('jitters the delay so two deadlocked transactions do not retry in step', () => {
    expect(beginBlock).toContain('Math.random()');
  });

  it('always decrements the in-flight gauge, including on the failure path', () => {
    // A gauge that leaks on errors reads as permanent load and hides real load.
    expect(beginBlock).toContain('finally');
    expect(beginBlock).toContain('dbTransactionsActive.dec()');
    expect(beginBlock.match(/dbTransactionsActive\.dec\(\)/g)).toHaveLength(1);
  });
});

describe('slow-query logging does not leak customer data', () => {
  it('logs the parameter count, never the values', () => {
    const slow = source.slice(source.indexOf('if (duration > 250)'), source.indexOf('const originalThen'));
    expect(slow).toContain('parameterCount');
    expect(slow).not.toMatch(/\bparameters,/);
  });

  it('still identifies which query was slow', () => {
    const slow = source.slice(source.indexOf('if (duration > 250)'), source.indexOf('const originalThen'));
    expect(slow).toContain('query,');
    expect(slow).toContain('duration,');
  });
});

describe('connection settings that bound a bad day', () => {
  it('bounds statement time so one query cannot hold a connection forever', () => {
    expect(source).toContain('statement_timeout');
  });

  it('bounds connection time and pool size', () => {
    expect(source).toContain('connect_timeout');
    expect(source).toContain('max: 20');
    expect(source).toContain('idle_timeout');
  });
});
