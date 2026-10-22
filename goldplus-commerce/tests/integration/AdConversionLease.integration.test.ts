import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Ad conversions are sent once, even when a batch outlives its lease (2026-10-22 review). Fifty sends of up to 10 s
 * each can run past five minutes; the other replica then claims what is still waiting. Each row is renewed just
 * before its send, and only while the deadline the worker wrote is still there.
 */
const URL_ = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL_ && process.env.DATABASE_URL ? describe : describe.skip;

suite('ad conversion lease (real PostgreSQL)', () => {
  let raw: any;
  let D: typeof import('../../apps/api/src/infrastructure/advertising/AdConversionDispatch');
  const tag = `it-ad-lease-${Date.now().toString(36)}`;

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL_ as string, { max: 2, onnotice: () => undefined });
    D = await import('../../apps/api/src/infrastructure/advertising/AdConversionDispatch');
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from outbox_events where idempotency_key like ${tag + '%'}`;
    await raw.end();
  });

  const row = async (key: string, fields: { status: string; nextAttemptAt: Date; processed?: boolean }) => {
    const [r] = await raw`insert into outbox_events (event_type, payload, idempotency_key, status, is_processed, next_attempt_at, related_entity, dry_run_only)
      values ('AD_CONVERSION', ${raw.json({ platform: 'it-not-a-platform', event: { event_id: key, event_name: 'purchase' } })}, ${`${tag}:${key}`},
        ${fields.status}, ${fields.processed ?? false}, ${fields.nextAttemptAt}, 'ad_destination', false) returning id`;
    return r.id as string;
  };
  const deadline = async (id: string) => new Date((await raw`select next_attempt_at from outbox_events where id = ${id}`)[0].next_attempt_at).getTime();

  it('renews a row only while it carries this worker\'s deadline', async () => {
    const claimedUntil = new Date(Date.now() + 5 * 60_000);
    const ours = await row('ours', { status: 'processing', nextAttemptAt: claimedUntil });
    expect(await D.renewAdConversionLease(ours, claimedUntil)).toBe(true);
    expect(await deadline(ours)).toBeGreaterThanOrEqual(claimedUntil.getTime() - 1000);

    // The lease ran out and another worker claimed it: its deadline is there now, so this worker leaves the row.
    const taken = await row('taken', { status: 'processing', nextAttemptAt: new Date(Date.now() + 7 * 60_000) });
    expect(await D.renewAdConversionLease(taken, claimedUntil)).toBe(false);

    // Already sent by the other worker.
    const done = await row('done', { status: 'sent', nextAttemptAt: claimedUntil, processed: true });
    expect(await D.renewAdConversionLease(done, claimedUntil)).toBe(false);
  });

  it('the batch still processes its own rows (the deadline it claims with is the one it renews against)', async () => {
    const past = new Date(Date.now() - 60_000);
    const a = await row('batch-a', { status: 'pending', nextAttemptAt: past });
    const b = await row('batch-b', { status: 'pending', nextAttemptAt: past });
    await D.processAdConversionBatch();
    const after = await raw`select id, status, is_processed from outbox_events where id = any(${[a, b]})`;
    // No such platform is live: each is finished as withdrawn, which happens only after the lease check passed.
    expect(after.map((r: any) => [r.status, r.is_processed])).toEqual([['withdrawn', true], ['withdrawn', true]]);
  });
});
