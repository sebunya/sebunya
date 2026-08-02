import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Slice 3B — durable, revocable sessions on a REAL PostgreSQL. Proves the whole
 * point of moving sessions out of a stateless token: rotation is single-use,
 * replay of a consumed credential is detected and ends the family, logout and
 * logout-everywhere revoke, inventory reflects reality, and expired credentials
 * are swept — all surviving with Redis entirely absent, because the record of
 * truth is the database.
 *
 * Set AUTH_TEST_DATABASE_URL to a MIGRATED database (users + auth_sessions from
 * migration 0063). Skips visibly otherwise.
 */
const URL = process.env.AUTH_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('durable revocable sessions (real PostgreSQL)', () => {
  let service: any;
  let repo: any;
  let raw: any;
  const userIds: string[] = [];

  const freshUser = async (): Promise<string> => {
    const email = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 9)}@example.com`;
    const [row] = await raw`
      insert into users (email, password_hash) values (${email}, 'x') returning id`;
    userIds.push(row.id);
    return row.id;
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });

    const repoMod = await import(
      '../../apps/api/src/infrastructure/db/repositories/DrizzleSessionRepository'
    );
    const svcMod = await import('../../apps/api/src/infrastructure/security/SessionService');
    repo = new repoMod.DrizzleSessionRepository();
    service = new svcMod.SessionService(repo);
  });

  afterAll(async () => {
    if (raw && userIds.length) {
      await raw`delete from auth_sessions where user_id = any(${userIds})`;
      await raw`delete from users where id = any(${userIds})`;
      await raw.end();
    }
  });

  it('issues a session, then rotation yields a new token and retires the old one', async () => {
    const userId = await freshUser();
    const issued = await service.issue({ userId });
    expect(issued.refreshToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    const rotated = await service.rotate({ refreshToken: issued.refreshToken });
    expect(rotated.ok).toBe(true);
    expect(rotated.session.refreshToken).not.toBe(issued.refreshToken);
    expect(rotated.session.familyId).toBe(issued.familyId); // same durable session

    // The new token rotates again; the family is preserved.
    const again = await service.rotate({ refreshToken: rotated.session.refreshToken });
    expect(again.ok).toBe(true);
  });

  it('detects replay of a consumed credential and revokes the whole family', async () => {
    const userId = await freshUser();
    const issued = await service.issue({ userId });
    const rotated = await service.rotate({ refreshToken: issued.refreshToken });
    expect(rotated.ok).toBe(true);

    // Replay the ORIGINAL (now consumed) token.
    const replay = await service.rotate({ refreshToken: issued.refreshToken });
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe('REUSE_DETECTED');

    // Reuse ends the family: even the currently-valid rotated token is now dead.
    const afterReuse = await service.rotate({ refreshToken: rotated.session.refreshToken });
    expect(afterReuse.ok).toBe(false);
    expect(afterReuse.reason).toBe('REVOKED');
  });

  it('makes concurrent submits of one credential single-use', async () => {
    const userId = await freshUser();
    const issued = await service.issue({ userId });
    const [a, b] = await Promise.all([
      service.rotate({ refreshToken: issued.refreshToken }),
      service.rotate({ refreshToken: issued.refreshToken }),
    ]);
    const oks = [a, b].filter((r) => r.ok);
    expect(oks).toHaveLength(1); // exactly one rotation wins
    const loser = [a, b].find((r) => !r.ok);
    expect(loser.reason).toBe('REUSE_DETECTED');
  });

  it('logout revokes only the current session; other sessions keep working', async () => {
    const userId = await freshUser();
    const s1 = await service.issue({ userId });
    const s2 = await service.issue({ userId });
    await service.logout(s1.refreshToken);

    expect((await service.rotate({ refreshToken: s1.refreshToken })).ok).toBe(false);
    expect((await service.rotate({ refreshToken: s2.refreshToken })).ok).toBe(true);
  });

  it('logout-all revokes every session for the user', async () => {
    const userId = await freshUser();
    const s1 = await service.issue({ userId });
    const s2 = await service.issue({ userId });
    const revoked = await service.logoutAll(userId);
    expect(revoked).toBeGreaterThanOrEqual(2);
    expect((await service.rotate({ refreshToken: s1.refreshToken })).ok).toBe(false);
    expect((await service.rotate({ refreshToken: s2.refreshToken })).ok).toBe(false);
  });

  it('inventory lists one active entry per live session and drops revoked ones', async () => {
    const userId = await freshUser();
    await service.issue({ userId });
    const keep = await service.issue({ userId });
    const drop = await service.issue({ userId });
    await service.logout(drop.refreshToken);

    const active = await repo.listActiveForUser(userId, new Date());
    const families = active.map((a: any) => a.familyId);
    expect(families).toContain(keep.familyId);
    expect(families).not.toContain(drop.familyId);
  });

  it('cleanup removes credentials whose refresh window has passed', async () => {
    const userId = await freshUser();
    const issued = await service.issue({ userId });
    // Force this family's credential to be long expired.
    await raw`update auth_sessions set refresh_expires_at = now() - interval '1 day' where user_id = ${userId}`;
    const removed = await repo.cleanupExpired(new Date());
    expect(removed).toBeGreaterThanOrEqual(1);
    // Gone -> a rotation now reads nothing and is treated as reuse.
    expect((await service.rotate({ refreshToken: issued.refreshToken })).reason).toBe(
      'REUSE_DETECTED',
    );
  });

  it('stores no raw refresh token — only its hash, never recoverable', async () => {
    const userId = await freshUser();
    const issued = await service.issue({ userId });
    const [row] = await raw`
      select refresh_hash from auth_sessions where user_id = ${userId} limit 1`;
    expect(row.refresh_hash).toHaveLength(64); // sha256 hex
    expect(row.refresh_hash).not.toContain(issued.refreshToken);
  });
});
