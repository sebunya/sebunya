import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The attempt compare-and-set, against real PostgreSQL.
 *
 * A mock repository will happily report success for a transition that never
 * happened, which is exactly the bug this primitive exists to prevent: a worker
 * that lost the race must not go on to call the provider. Only the database can
 * adjudicate that, so only the database is asked here.
 *
 * Set COMMERCE_TEST_DATABASE_URL to a MIGRATED database. Skips otherwise.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('notification attempt CAS on real PostgreSQL', () => {
  let raw: any;
  let repo: any;
  const attemptIds: string[] = [];
  const tag = `cas-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  /** Inserts an attempt in a given phase and remembers it for cleanup. */
  const seed = async (status: string): Promise<string> => {
    const [row] = await raw`
      insert into notification_attempts (channel, recipient, template, status, related_entity)
      values ('email', ${`${tag}@example.test`}, 'PASSWORD_RESET', ${status}, 'password_reset')
      returning id`;
    attemptIds.push(row.id);
    return row.id as string;
  };

  const statusOf = async (id: string): Promise<string> => {
    const [row] = await raw`select status from notification_attempts where id = ${id}`;
    return row.status;
  };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    const mod = await import(
      '../../apps/api/src/infrastructure/db/repositories/DrizzleNotificationAttemptRepository'
    );
    repo = new (mod as any).DrizzleNotificationAttemptRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    if (attemptIds.length) await raw`delete from notification_attempts where id = any(${attemptIds})`;
    await raw.end({ timeout: 5 });
  });

  it('stores the lifecycle phases the widened union introduced', async () => {
    // varchar(30), no CHECK constraint — but prove it rather than assume it.
    for (const status of ['PENDING', 'PREPARED', 'DISPATCH_STARTED', 'NOT_DISPATCHED']) {
      const id = await seed(status);
      expect(await statusOf(id)).toBe(status);
    }
  });

  it('moves an attempt across the dispatch boundary', async () => {
    const id = await seed('PREPARED');
    const moved = await repo.transitionStatus({
      attemptId: id,
      expectedStatus: 'PREPARED',
      nextStatus: 'DISPATCH_STARTED',
    });
    expect(moved).toBe(true);
    expect(await statusOf(id)).toBe('DISPATCH_STARTED');
  });

  it('refuses a transition whose expected status is stale', async () => {
    const id = await seed('PREPARED');
    await repo.transitionStatus({ attemptId: id, expectedStatus: 'PREPARED', nextStatus: 'DISPATCH_STARTED' });

    // A second worker still believes the attempt is PREPARED.
    const stale = await repo.transitionStatus({
      attemptId: id,
      expectedStatus: 'PREPARED',
      nextStatus: 'DISPATCH_STARTED',
    });

    expect(stale).toBe(false);
    expect(await statusOf(id)).toBe('DISPATCH_STARTED');
  });

  it('lets exactly one of two concurrent workers cross the boundary', async () => {
    const id = await seed('PREPARED');

    // Both fire simultaneously, as two ticker instances would.
    const results = await Promise.all([
      repo.transitionStatus({ attemptId: id, expectedStatus: 'PREPARED', nextStatus: 'DISPATCH_STARTED' }),
      repo.transitionStatus({ attemptId: id, expectedStatus: 'PREPARED', nextStatus: 'DISPATCH_STARTED' }),
    ]);

    // The loser must be TOLD it lost — this is what stops it calling the provider.
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await statusOf(id)).toBe('DISPATCH_STARTED');
  });

  it('cannot rewrite an outcome that is already decided', async () => {
    const id = await seed('SENT');
    const rewritten = await repo.transitionStatus({
      attemptId: id,
      expectedStatus: 'DISPATCH_STARTED',
      nextStatus: 'FAILED',
    });
    expect(rewritten).toBe(false);
    expect(await statusOf(id)).toBe('SENT');
  });

  it('records provider evidence with the terminal transition', async () => {
    const id = await seed('DISPATCH_STARTED');
    const moved = await repo.transitionStatus({
      attemptId: id,
      expectedStatus: 'DISPATCH_STARTED',
      nextStatus: 'FAILED',
      providerCode: 'PROVIDER_RATE_LIMITED',
      providerMessage: 'HTTP error status 429 | class=rate_limited',
    });
    expect(moved).toBe(true);

    const [row] = await raw`select status, provider_code, provider_message from notification_attempts where id = ${id}`;
    expect(row.status).toBe('FAILED');
    expect(row.provider_code).toBe('PROVIDER_RATE_LIMITED');
    expect(row.provider_message).toContain('rate_limited');
  });

  it('leaves provider evidence untouched when the caller supplies none', async () => {
    const id = await seed('PREPARED');
    await raw`update notification_attempts set provider_code = 'KEEP_ME' where id = ${id}`;

    // Crossing the dispatch boundary carries no provider answer yet; blanking
    // the column here would erase evidence a later transition depends on.
    await repo.transitionStatus({ attemptId: id, expectedStatus: 'PREPARED', nextStatus: 'DISPATCH_STARTED' });

    const [row] = await raw`select provider_code from notification_attempts where id = ${id}`;
    expect(row.provider_code).toBe('KEEP_ME');
  });

  it('touches only the attempt it was asked to move', async () => {
    const target = await seed('PREPARED');
    const bystander = await seed('PREPARED');

    await repo.transitionStatus({ attemptId: target, expectedStatus: 'PREPARED', nextStatus: 'DISPATCH_STARTED' });

    expect(await statusOf(bystander)).toBe('PREPARED');
  });
});
