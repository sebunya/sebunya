import { describe, it, expect } from 'vitest';
import { AdminUserManagementUseCase, type IAdminUserWriteRepository } from '../../apps/api/src/application/use-cases/identity/AdminUserManagementUseCase';
import { PLATFORM_ADMINISTRATOR_ROLE } from '@goldplus/shared';

/**
 * Pre-live admin audit, 2026-09-12 — access governance guards.
 * The existing SELF_LOCKOUT guard only stopped an administrator revoking their
 * OWN full-admin role; another administrator could still strip the last one,
 * and no operation could deactivate an account at all.
 */
function build(opts: { users: Record<string, { isActive: boolean; roles: string[] }> }) {
  const users = structuredClone(opts.users);
  const invalidated: string[] = [];
  const repo = {
    findUserById: async (id: string) => (users[id] ? { id, isActive: users[id].isActive } : null),
    userHasRole: async (id: string, role: string) => Boolean(users[id]?.roles.includes(role)),
    countActiveUsersWithRole: async (role: string) => Object.values(users).filter((u) => u.isActive && u.roles.includes(role)).length,
    countActiveUsersWithAnyRole: async (roles: readonly string[]) => Object.values(users).filter((u) => u.isActive && roles.some((r) => u.roles.includes(r))).length,
    revokeRole: async (id: string, role: string) => { const u = users[id]; if (!u) return false; const had = u.roles.includes(role); u.roles = u.roles.filter((r) => r !== role); return had; },
    setUserActive: async (id: string, active: boolean) => { if (!users[id]) return false; users[id].isActive = active; return true; },
  } as unknown as IAdminUserWriteRepository;
  const uc = new AdminUserManagementUseCase(repo, { hash: async (p) => p }, { invalidateSessionsAfter: async (id) => { invalidated.push(id); } });
  return { uc, users, invalidated };
}
const ADMIN = PLATFORM_ADMINISTRATOR_ROLE;

describe('revoking PLATFORM_ADMINISTRATOR', () => {
  it('refuses when the target is the LAST active full admin, even for a different actor', async () => {
    const { uc, users } = build({ users: { a: { isActive: true, roles: [ADMIN] }, b: { isActive: true, roles: ['LEGAL_REVIEWER'] } } });
    const r = await uc.revokeRole({ userId: 'a', roleName: ADMIN, actorId: 'b' });
    expect(r).toMatchObject({ ok: false, code: 'LAST_ADMIN' });
    expect(users.a.roles).toContain(ADMIN);
  });
  it('allows it when another active full admin remains', async () => {
    const { uc, users } = build({ users: { a: { isActive: true, roles: [ADMIN] }, b: { isActive: true, roles: [ADMIN] } } });
    expect((await uc.revokeRole({ userId: 'a', roleName: ADMIN, actorId: 'b' })).ok).toBe(true);
    expect(users.a.roles).not.toContain(ADMIN);
  });
  it('an INACTIVE second admin does not count as remaining cover', async () => {
    const { uc } = build({ users: { a: { isActive: true, roles: [ADMIN] }, b: { isActive: false, roles: [ADMIN] }, c: { isActive: true, roles: [] } } });
    expect(await uc.revokeRole({ userId: 'a', roleName: ADMIN, actorId: 'c' })).toMatchObject({ ok: false, code: 'LAST_ADMIN' });
  });
  it('still refuses revoking your own full-admin role', async () => {
    const { uc } = build({ users: { a: { isActive: true, roles: [ADMIN] }, b: { isActive: true, roles: [ADMIN] } } });
    expect(await uc.revokeRole({ userId: 'a', roleName: ADMIN, actorId: 'a' })).toMatchObject({ ok: false, code: 'SELF_LOCKOUT' });
  });
});

describe('deactivating / reactivating an account', () => {
  it('never yourself', async () => {
    const { uc } = build({ users: { a: { isActive: true, roles: [ADMIN] } } });
    expect(await uc.setActive({ userId: 'a', active: false, actorId: 'a', reason: 'leaving' })).toMatchObject({ ok: false, code: 'SELF_LOCKOUT' });
  });
  it('never the last active full admin', async () => {
    const { uc } = build({ users: { a: { isActive: true, roles: [ADMIN] }, b: { isActive: true, roles: ['LEGAL_REVIEWER'] } } });
    expect(await uc.setActive({ userId: 'a', active: false, actorId: 'b', reason: 'left company' })).toMatchObject({ ok: false, code: 'LAST_ADMIN' });
  });
  it('requires a reason to deactivate', async () => {
    const { uc } = build({ users: { a: { isActive: true, roles: [ADMIN] }, b: { isActive: true, roles: [] } } });
    expect(await uc.setActive({ userId: 'b', active: false, actorId: 'a', reason: '' })).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
  });
  it('deactivates a normal account and ends its live sessions', async () => {
    const { uc, users, invalidated } = build({ users: { a: { isActive: true, roles: [ADMIN] }, b: { isActive: true, roles: ['LEGAL_REVIEWER'] } } });
    const r = await uc.setActive({ userId: 'b', active: false, actorId: 'a', reason: 'left company' });
    expect(r).toMatchObject({ ok: true, value: { changed: true, active: false } });
    expect(users.b.isActive).toBe(false);
    expect(invalidated).toEqual(['b']);
  });
  it('reactivates without a reason and is idempotent', async () => {
    const { uc, users, invalidated } = build({ users: { a: { isActive: true, roles: [ADMIN] }, b: { isActive: false, roles: [] } } });
    expect(await uc.setActive({ userId: 'b', active: true, actorId: 'a' })).toMatchObject({ ok: true, value: { changed: true, active: true } });
    expect(await uc.setActive({ userId: 'b', active: true, actorId: 'a' })).toMatchObject({ ok: true, value: { changed: false } });
    expect(users.b.isActive).toBe(true);
    expect(invalidated).toEqual([]);
  });
  it('unknown user is NOT_FOUND', async () => {
    const { uc } = build({ users: { a: { isActive: true, roles: [ADMIN] } } });
    expect(await uc.setActive({ userId: 'zz', active: false, actorId: 'a', reason: 'gone' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
