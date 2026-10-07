import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isInvalidatedByCutoff } from '../../apps/api/src/domain/identity/SessionPolicy';

/**
 * Google/Apple auto-link onto a password account (2026-10-07, real PostgreSQL).
 * Registration never proves the email, so the password may be an attacker's.
 * Linking clears it, signs out every older session, voids unused reset links,
 * and must NOT void the token this sign-in issues in the same second.
 */
const URL = process.env.AUTH_TEST_DATABASE_URL ?? process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('social link revokes an unproven password (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  const userIds: string[] = [];

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL as string, { max: 2, onnotice: () => undefined });
    const { DrizzleSocialIdentityRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleSocialIdentityRepository');
    repo = new DrizzleSocialIdentityRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    if (userIds.length) {
      await raw`delete from user_identities where user_id = any(${userIds})`;
      await raw`delete from users where id = any(${userIds})`;
    }
    await raw.end();
  });

  const seedUser = async () => {
    const email = `it-${crypto.randomUUID()}@example.com`;
    const [u] = await raw`insert into users (email, password_hash) values (${email}, 'attacker-chosen-hash') returning id`;
    userIds.push(u.id);
    return { id: u.id as string, email };
  };

  it('clears the password and cuts off older sessions, but not this sign-in', async () => {
    const { id, email } = await seedUser();
    const attackerTokenIat = new Date(Date.now() - 5_000);
    await repo.link({ userId: id, provider: 'google', subject: `g-${id}`, email, emailVerified: true, revokePasswordAccess: true });
    const [u] = await raw`select password_hash, sessions_invalidated_after from users where id = ${id}`;
    expect(u.password_hash).toBeNull();
    const cutoff = new Date(u.sessions_invalidated_after);
    expect(isInvalidatedByCutoff(attackerTokenIat, cutoff)).toBe(true);
    // A JWT iat is whole seconds: the token issued right after linking.
    const freshIat = new Date(Math.floor(Date.now() / 1000) * 1000);
    expect(isInvalidatedByCutoff(freshIat, cutoff)).toBe(false);
    expect((await raw`select count(*)::int as n from user_identities where user_id = ${id}`)[0].n).toBe(1);
  });

  it('leaves the password alone when not asked to revoke', async () => {
    const { id, email } = await seedUser();
    await repo.link({ userId: id, provider: 'apple', subject: `a-${id}`, email, emailVerified: true });
    const [u] = await raw`select password_hash, sessions_invalidated_after from users where id = ${id}`;
    expect(u.password_hash).toBe('attacker-chosen-hash');
    expect(u.sessions_invalidated_after).toBeNull();
  });
});
