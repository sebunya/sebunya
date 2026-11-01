import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The month spend ledger under concurrency (mandate §5.10, §5A.H.7): twenty
 * reservations race for the last cents of a month; exactly as many as fit
 * under the kill threshold succeed, the rest are refused, and settlement,
 * release and stale-expiry keep the totals honest. Real PostgreSQL.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('assistant ledger (real PostgreSQL)', () => {
  let raw: any;
  let repo: import('../../apps/api/src/infrastructure/db/repositories/DrizzleAssistantRepository').DrizzleAssistantLedgerRepository;
  const month = `t-${Date.now().toString(36).slice(-5)}`; // 7 chars (the column width), never a real month; cleaned up below
  const principal = 'a'.repeat(32);

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 2, onnotice: () => undefined });
    const mod = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAssistantRepository');
    repo = new mod.DrizzleAssistantLedgerRepository();
  });

  afterAll(async () => {
    await raw`delete from assistant_model_calls where month = ${month}`;
    await raw.end();
  });

  it('twenty concurrent reservations near the kill threshold: exactly the ones that fit succeed', async () => {
    const kill = 100_000; // $0.10 for this synthetic month
    const amount = 10_560;  // the default per-turn reservation
    const results = await Promise.all(Array.from({ length: 20 }, () =>
      repo.reserve({ month, amountMicroUsd: amount, killThresholdMicroUsd: kill, model: 'claude-haiku-5-5', principalHash: principal, conversationId: null, staleAfterMs: 600_000 })));
    const granted = results.filter((r) => r !== null);
    expect(granted.length).toBe(Math.floor(kill / amount)); // 9
    const totals = await repo.totals(month);
    expect(totals.counts.RESERVED).toBe(9);
    expect(totals.reservedMicroUsd).toBe(9 * amount);
    expect(totals.settledMicroUsd).toBe(0);
  });

  it('settlement replaces the reservation with the real cost and releases the headroom', async () => {
    const before = await repo.totals(month);
    const open = (await repo.recent(month, 50)).filter((r) => r.status === 'RESERVED');
    const first = open[0]!;
    const settled = await repo.settle({ id: first.id, usage: { inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 }, costMicroUsd: 300, providerRequestId: 'msg_test', outcome: 'ANSWERED' });
    expect(settled?.settledAfter).toBe(300);
    const after = await repo.totals(month);
    expect(after.settledMicroUsd).toBe(300);
    expect(after.reservedMicroUsd).toBe(before.reservedMicroUsd - 10_560);
    // Settling twice is refused (idempotent by status).
    expect(await repo.settle({ id: first.id, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, costMicroUsd: 1, providerRequestId: null, outcome: 'ANSWERED' })).toBeNull();
    // A release frees a reservation that was certainly not billed; a settled row cannot be released.
    const second = open[1]!;
    expect(await repo.release({ id: second.id, reason: 'upstream 429 before output' })).toBe(true);
    expect(await repo.release({ id: first.id, reason: 'x' })).toBe(false);
    const final = await repo.totals(month);
    expect(final.counts.RELEASED).toBe(1);
    expect(final.reservedMicroUsd).toBe(before.reservedMicroUsd - 2 * 10_560);
  });

  it('a stale reservation becomes UNKNOWN and keeps counting against the month', async () => {
    const open = (await repo.recent(month, 50)).filter((r) => r.status === 'RESERVED');
    expect(open.length).toBeGreaterThan(0);
    await raw`update assistant_model_calls set created_at = now() - interval '1 hour' where id = ${open[0]!.id}`;
    const r = await repo.reserve({ month, amountMicroUsd: 1, killThresholdMicroUsd: 1_000_000_000, model: 'claude-haiku-5-5', principalHash: principal, conversationId: null, staleAfterMs: 60_000 });
    expect(r).not.toBeNull();
    const totals = await repo.totals(month);
    expect(totals.counts.UNKNOWN).toBe(1);
    expect(totals.reservedMicroUsd).toBeGreaterThanOrEqual(10_560); // the UNKNOWN row is still money at risk
  });
});
