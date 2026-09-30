import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Fixtures } from './helpers/fixtures';

/**
 * The write behind "change password": new hash, session cutoff and the voiding
 * of outstanding reset links, in one transaction, for that account only.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('change password persistence (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  let fx: Fixtures;

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL as string, { max: 2, onnotice: () => undefined });
    const { DrizzleUserRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleUserRepository');
    repo = new DrizzleUserRepository();
    fx = new Fixtures(raw);
  });

  afterAll(async () => {
    if (!raw) return;
    await fx.cleanup();
    await raw.end();
  });

  const resetLink = async (userId: string) => {
    const hash = createHash('sha256').update(randomBytes(16)).digest('hex');
    const [t] = await raw`insert into password_reset_tokens (user_id, token_hash, expires_at) values (${userId}, ${hash}, now() + interval '1 hour') returning id`;
    return t.id as string;
  };

  it('sets the hash, stamps the session cutoff and voids unused reset links, leaving other accounts alone', async () => {
    const me = await fx.user();
    const other = await fx.user();
    const mine = await resetLink(me);
    const theirs = await resetLink(other);
    const before = new Date(Date.now() - 1000);

    await repo.setPasswordAndRevoke(me, 'new-hash');

    const [u] = await raw`select password_hash, sessions_invalidated_after from users where id = ${me}`;
    expect(u.password_hash).toBe('new-hash');
    expect(new Date(u.sessions_invalidated_after).getTime()).toBeGreaterThan(before.getTime());
    expect((await raw`select consumed_at from password_reset_tokens where id = ${mine}`)[0].consumed_at).not.toBeNull();

    const [o] = await raw`select password_hash, sessions_invalidated_after from users where id = ${other}`;
    expect(o.password_hash).toBe('x');
    expect(o.sessions_invalidated_after).toBeNull();
    expect((await raw`select consumed_at from password_reset_tokens where id = ${theirs}`)[0].consumed_at).toBeNull();

    await raw`delete from password_reset_tokens where user_id in (${me}, ${other})`;
  });
});
