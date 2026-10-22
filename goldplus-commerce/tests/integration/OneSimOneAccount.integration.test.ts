import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/** phoneHeldByAnother (2026-10-22): another account's number, in any written form, never the asker's own. */
const URL = process.env.AUTH_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('one SIM, one account (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  const tag = randomUUID().slice(0, 8);
  const national = `7${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  let a = ''; let b = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    [{ id: a }] = await raw`insert into users (email, password_hash, phone) values (${`sim-a-${tag}@example.test`}, 'x', ${`0${national}`}) returning id`;
    [{ id: b }] = await raw`insert into users (email, password_hash) values (${`sim-b-${tag}@example.test`}, 'x') returning id`;
    const { DrizzleLoyaltyIdentityRepository } = await import('../../apps/api/src/infrastructure/loyalty/LoyaltyIdentityInfrastructure');
    repo = new DrizzleLoyaltyIdentityRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from users where id in (${a}, ${b})`;
    await raw.end({ timeout: 5 });
  });

  it('a number account A holds as 07… is held against account B asking as +256…', async () => {
    expect(await repo.phoneHeldByAnother(b, `+256${national}`)).toBe(true);
  });

  it('never against the account that holds it', async () => {
    expect(await repo.phoneHeldByAnother(a, `+256${national}`)).toBe(false);
  });
});
