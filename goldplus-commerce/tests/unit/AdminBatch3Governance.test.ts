import { describe, expect, it } from 'vitest';

import { PERMISSIONS, PLATFORM_ADMINISTRATOR_ROLE } from '@goldplus/shared';
import {
  AdminUserManagementUseCase,
  type IAdminUserWriteRepository,
} from '../../apps/api/src/application/use-cases/identity/AdminUserManagementUseCase';
import { RoleManagementUseCase } from '../../apps/api/src/application/use-cases/admin/RoleManagementUseCase';
import type { IAdminRoleWriteRepository } from '../../apps/api/src/application/ports/IAdminRoleWriteRepository';

/**
 * Admin sweep batch 3 (2026-09-24) — access governance.
 *  - a custom role could carry every permission and be self-assigned with no
 *    second approver;
 *  - the lockout guards protected PLATFORM_ADMINISTRATOR but not Owner.
 */

type U = { isActive: boolean; roles: string[] };
function userUc(users: Record<string, U>, roleCodes: Record<string, string[]> = {}) {
  const requests: Array<{ userId: string; roleName: string; requestedBy: string }> = [];
  const repo = {
    roleExists: async (r: string) => true && r.length > 0,
    findUserById: async (id: string) => (users[id] ? { id, isActive: users[id].isActive } : null),
    userHasRole: async (id: string, role: string) => Boolean(users[id]?.roles.includes(role)),
    countActiveUsersWithRole: async (role: string) => Object.values(users).filter((u) => u.isActive && u.roles.includes(role)).length,
    countActiveUsersWithAnyRole: async (roles: readonly string[]) =>
      Object.values(users).filter((u) => u.isActive && roles.some((r) => u.roles.includes(r))).length,
    rolePermissionCodes: async (r: string) => roleCodes[r] ?? [],
    assignRole: async (id: string, role: string) => { users[id] ??= { isActive: true, roles: [] }; users[id].roles.push(role); return true; },
    revokeRole: async (id: string, role: string) => { const u = users[id]; if (!u) return false; const had = u.roles.includes(role); u.roles = u.roles.filter((r) => r !== role); return had; },
    setUserActive: async (id: string, active: boolean) => { if (!users[id]) return false; users[id].isActive = active; return true; },
    createGrantRequest: async (input: { userId: string; roleName: string; requestedBy: string }) => { requests.push(input); return { id: `req-${requests.length}` }; },
  } as unknown as IAdminUserWriteRepository;
  return { uc: new AdminUserManagementUseCase(repo, { hash: async (p) => p }, { invalidateSessionsAfter: async () => {} }), users, requests };
}

describe('grantRole: no self-grant, and elevated custom roles need a second approver', () => {
  it('refuses granting any role to yourself', async () => {
    const { uc, users } = userUc({ me: { isActive: true, roles: ['SECURITY_ADMIN'] } });
    const r = await uc.grantRole({ userId: 'me', roleName: 'SUPPORT_OPERATOR', actorId: 'me' });
    expect(r).toMatchObject({ ok: false, code: 'SELF_GRANT', status: 403 });
    expect(users.me.roles).not.toContain('SUPPORT_OPERATOR');
  });

  it('turns a custom role carrying auth.manage / roles.manage into a pending request', async () => {
    const all = Object.values(PERMISSIONS) as string[];
    const { uc, users, requests } = userUc(
      { sec: { isActive: true, roles: ['SECURITY_ADMIN'] }, other: { isActive: true, roles: [] } },
      { SHADOW_ADMIN: all, ACCESS_DESK: [PERMISSIONS.ROLES_MANAGE] },
    );
    expect(await uc.grantRole({ userId: 'other', roleName: 'SHADOW_ADMIN', actorId: 'sec' })).toMatchObject({ ok: true, value: { outcome: 'PENDING_APPROVAL' } });
    expect(await uc.grantRole({ userId: 'other', roleName: 'ACCESS_DESK', actorId: 'sec' })).toMatchObject({ ok: true, value: { outcome: 'PENDING_APPROVAL' } });
    expect(users.other.roles).toEqual([]);
    expect(requests.map((r) => r.roleName)).toEqual(['SHADOW_ADMIN', 'ACCESS_DESK']);
  });

  it('still assigns an ordinary custom role directly to someone else', async () => {
    const { uc, users } = userUc({ sec: { isActive: true, roles: [] }, other: { isActive: true, roles: [] } }, { PACKER: [PERMISSIONS.ORDERS_READ] });
    expect(await uc.grantRole({ userId: 'other', roleName: 'PACKER', actorId: 'sec' })).toMatchObject({ ok: true, value: { outcome: 'ASSIGNED' } });
    expect(users.other.roles).toContain('PACKER');
  });
});

describe('lockout guards cover Owner as well as PLATFORM_ADMINISTRATOR', () => {
  it('refuses self-revoke of Owner', async () => {
    const { uc } = userUc({ owner: { isActive: true, roles: ['Owner'] }, pa: { isActive: true, roles: [PLATFORM_ADMINISTRATOR_ROLE] } });
    expect(await uc.revokeRole({ userId: 'owner', roleName: 'Owner', actorId: 'owner' })).toMatchObject({ ok: false, code: 'SELF_LOCKOUT' });
  });

  it('refuses revoking Owner from the last full-access account', async () => {
    const { uc, users } = userUc({ owner: { isActive: true, roles: ['Owner'] }, sec: { isActive: true, roles: ['SECURITY_ADMIN'] } });
    expect(await uc.revokeRole({ userId: 'owner', roleName: 'Owner', actorId: 'sec' })).toMatchObject({ ok: false, code: 'LAST_ADMIN' });
    expect(users.owner.roles).toContain('Owner');
  });

  it('refuses deactivating the last Owner-only account', async () => {
    const { uc, users } = userUc({ owner: { isActive: true, roles: ['Owner'] }, sec: { isActive: true, roles: ['SECURITY_ADMIN'] } });
    expect(await uc.setActive({ userId: 'owner', active: false, actorId: 'sec', reason: 'left the company' })).toMatchObject({ ok: false, code: 'LAST_ADMIN' });
    expect(users.owner.isActive).toBe(true);
  });

  it('counts a user holding both roles once, and allows revoking one of them', async () => {
    const { uc, users } = userUc({ both: { isActive: true, roles: ['Owner', PLATFORM_ADMINISTRATOR_ROLE] }, sec: { isActive: true, roles: [] } });
    // Revoking Owner leaves them PLATFORM_ADMINISTRATOR, so full access remains.
    expect((await uc.revokeRole({ userId: 'both', roleName: 'Owner', actorId: 'sec' })).ok).toBe(true);
    // Now they are the last holder of any full-access role.
    expect(await uc.revokeRole({ userId: 'both', roleName: PLATFORM_ADMINISTRATOR_ROLE, actorId: 'sec' })).toMatchObject({ ok: false, code: 'LAST_ADMIN' });
    expect(users.both.roles).toEqual([PLATFORM_ADMINISTRATOR_ROLE]);
  });

  it('allows revoking Owner when a PLATFORM_ADMINISTRATOR remains', async () => {
    const { uc } = userUc({ owner: { isActive: true, roles: ['Owner'] }, pa: { isActive: true, roles: [PLATFORM_ADMINISTRATOR_ROLE] } });
    expect((await uc.revokeRole({ userId: 'owner', roleName: 'Owner', actorId: 'pa' })).ok).toBe(true);
  });
});

describe('role editing: nobody hands out a permission they do not hold', () => {
  const roles = new Map<string, { id: string; name: string; permissionCodes: string[]; userCount: number }>();
  const repo: IAdminRoleWriteRepository = {
    findRoleByName: async (n: string) => [...roles.values()].find((r) => r.name === n) ?? null,
    findRoleById: async (id: string) => roles.get(id) ?? null,
    createRole: async (name: string, permissionCodes: string[]) => { const id = `r-${roles.size + 1}`; roles.set(id, { id, name, permissionCodes, userCount: 0 }); return { id }; },
    replacePermissions: async (id: string, codes: string[]) => { roles.get(id)!.permissionCodes = codes; },
    deleteRole: async (id: string) => { roles.delete(id); },
    countActiveUsersWithPermissionOutsideRole: async () => 1,
  } as unknown as IAdminRoleWriteRepository;
  const uc = new RoleManagementUseCase(repo);
  const securityAdmin = [PERMISSIONS.AUTH_MANAGE, PERMISSIONS.ROLES_MANAGE, PERMISSIONS.AUDIT_READ];

  it('refuses a new role with codes beyond the actor', async () => {
    const r = await uc.createRole({ name: 'SHADOW_ADMIN', permissionCodes: [PERMISSIONS.PAYMENTS_REFUND, PERMISSIONS.AUDIT_READ], actorId: 'sec', actorPermissions: securityAdmin });
    expect(r).toMatchObject({ ok: false, code: 'BEYOND_OWN_PERMISSIONS', status: 403 });
  });

  it('allows a role within the actor, and edits that only add held codes', async () => {
    const r = await uc.createRole({ name: 'AUDIT_DESK', permissionCodes: [PERMISSIONS.AUDIT_READ], actorId: 'sec', actorPermissions: securityAdmin });
    expect(r.ok).toBe(true);
    const id = r.ok ? r.value.id : '';
    expect(await uc.replacePermissions({ roleId: id, permissionCodes: [PERMISSIONS.AUDIT_READ, PERMISSIONS.PRICING_APPROVE], actorId: 'sec', actorPermissions: securityAdmin }))
      .toMatchObject({ ok: false, code: 'BEYOND_OWN_PERMISSIONS' });
    expect((await uc.replacePermissions({ roleId: id, permissionCodes: [PERMISSIONS.AUDIT_READ, PERMISSIONS.AUTH_MANAGE], actorId: 'sec', actorPermissions: securityAdmin })).ok).toBe(true);
  });

  it('lets a full-access holder (every code) create any role', async () => {
    const all = Object.values(PERMISSIONS) as string[];
    expect((await uc.createRole({ name: 'FINANCE_DESK', permissionCodes: [PERMISSIONS.PAYMENTS_REFUND], actorId: 'pa', actorPermissions: all })).ok).toBe(true);
  });
});

describe('full-access grant approval is not blind', () => {
  it('decideGrant reports who received which role, so the user-entity audit row can name them', async () => {
    const repo = {
      findGrantRequest: async () => ({ id: 'g1', userId: 'target', roleName: PLATFORM_ADMINISTRATOR_ROLE, status: 'PENDING', requestedBy: 'maker' }),
      decideGrantRequest: async () => {},
      assignRole: async () => true,
    } as unknown as IAdminUserWriteRepository;
    const uc = new AdminUserManagementUseCase(repo, { hash: async (p) => p });
    expect(await uc.decideGrant({ requestId: 'g1', decision: 'APPROVED', actorId: 'checker' }))
      .toEqual({ ok: true, value: { decided: 'APPROVED', userId: 'target', roleName: PLATFORM_ADMINISTRATOR_ROLE } });
  });

  it('the users page shows target, requester, reason, and offers Withdraw; the route audits on entity user', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('apps/web/src/pages/admin/users/index.astro', 'utf8');
    expect(page).toMatch(/emailById\.get\(r\.userId\)/);
    expect(page).toMatch(/emailById\.get\(r\.requestedBy\)/);
    expect(page).toMatch(/r\.reason/);
    expect(page).toMatch(/value="withdraw-grant"/);
    expect(page).not.toMatch(/\{r\.userId\.slice\(0,8\)\}…/);
    const route = readFileSync('apps/api/src/interfaces/http/routes/admin/users.ts', 'utf8');
    expect(route).toMatch(/action: 'ADMIN_ROLE_GRANT_APPROVED', entity: 'user', entityId: outcome\.value\.userId/);
  });
});
