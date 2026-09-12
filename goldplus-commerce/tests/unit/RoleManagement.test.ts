import { describe, expect, it } from 'vitest';
import { RoleManagementUseCase } from '../../apps/api/src/application/use-cases/admin/RoleManagementUseCase';
import type { AdminRoleDetail, IAdminRoleWriteRepository } from '../../apps/api/src/application/ports/IAdminRoleWriteRepository';
import { PERMISSIONS } from '@goldplus/shared';

/**
 * Role management guards (2026-09-12): system roles are immutable, only
 * registry codes can be granted, the last access manager cannot be locked
 * out by a save, and a role in use cannot be deleted.
 */
class FakeRoles implements IAdminRoleWriteRepository {
  roles = new Map<string, AdminRoleDetail>();
  /** userId -> { active, roleIds } */
  holders = new Map<string, { active: boolean; roleIds: string[] }>();
  private seq = 0;

  seed(name: string, codes: string[], userCount = 0): string {
    const id = `r-${++this.seq}`;
    this.roles.set(id, { id, name, permissionCodes: [...codes].sort(), userCount });
    return id;
  }
  async findRoleByName(name: string) {
    const r = [...this.roles.values()].find((x) => x.name === name);
    return r ? { id: r.id, name: r.name } : null;
  }
  async findRoleById(id: string) {
    const r = this.roles.get(id);
    return r ? { ...r, permissionCodes: [...r.permissionCodes] } : null; // a snapshot, as a database read is
  }
  async createRole(name: string, permissionCodes: string[]) {
    return { id: this.seed(name, permissionCodes) };
  }
  async replacePermissions(roleId: string, permissionCodes: string[]) {
    const r = this.roles.get(roleId)!;
    r.permissionCodes = [...permissionCodes].sort();
  }
  async deleteRole(roleId: string) {
    this.roles.delete(roleId);
  }
  async countActiveUsersWithPermissionOutsideRole(code: string, roleId: string) {
    let n = 0;
    for (const h of this.holders.values()) {
      if (!h.active) continue;
      if (h.roleIds.some((rid) => rid !== roleId && (this.roles.get(rid)?.permissionCodes ?? []).includes(code))) n++;
    }
    return n;
  }
}

const actorId = 'admin-1';

describe('RoleManagementUseCase — creating roles', () => {
  it('creates a role with registry codes only, and refuses names outside the pattern, duplicates and system names', async () => {
    const repo = new FakeRoles();
    repo.seed('SUPPORT_OPERATOR', [PERMISSIONS.ORDERS_READ]);
    const uc = new RoleManagementUseCase(repo);

    const ok = await uc.createRole({ name: 'SUPPORT_LEAD', permissionCodes: [PERMISSIONS.ORDERS_READ, PERMISSIONS.ORDERS_MANAGE, PERMISSIONS.ORDERS_READ], actorId });
    expect(ok).toMatchObject({ ok: true, value: { name: 'SUPPORT_LEAD', permissionCodes: [PERMISSIONS.ORDERS_MANAGE, PERMISSIONS.ORDERS_READ] } });

    expect(await uc.createRole({ name: 'support lead', permissionCodes: [], actorId })).toMatchObject({ ok: false, code: 'BAD_NAME' });
    expect(await uc.createRole({ name: 'AB', permissionCodes: [], actorId })).toMatchObject({ ok: false, code: 'BAD_NAME' });
    expect(await uc.createRole({ name: 'SUPPORT_OPERATOR', permissionCodes: [], actorId })).toMatchObject({ ok: false, code: 'DUPLICATE', status: 409 });
    expect(await uc.createRole({ name: 'PLATFORM_ADMINISTRATOR', permissionCodes: [], actorId })).toMatchObject({ ok: false, code: 'SYSTEM_ROLE', status: 409 });
    expect(await uc.createRole({ name: 'OWNER_TWO', permissionCodes: ['read.products'], actorId })).toMatchObject({ ok: false, code: 'UNKNOWN_PERMISSION' });
  });
});

describe('RoleManagementUseCase — editing permissions', () => {
  it('replaces the set exactly and reports what was added and removed', async () => {
    const repo = new FakeRoles();
    const id = repo.seed('ANALYST', [PERMISSIONS.REPORTS_READ, PERMISSIONS.ORDERS_READ]);
    const uc = new RoleManagementUseCase(repo);
    const r = await uc.replacePermissions({ roleId: id, permissionCodes: [PERMISSIONS.REPORTS_READ, PERMISSIONS.ANALYTICS_READ], actorId });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.previousCodes).toEqual([PERMISSIONS.ORDERS_READ, PERMISSIONS.REPORTS_READ]);
      expect(r.value.nextCodes).toEqual([PERMISSIONS.ANALYTICS_READ, PERMISSIONS.REPORTS_READ]);
    }
    expect(repo.roles.get(id)!.permissionCodes).toEqual([PERMISSIONS.ANALYTICS_READ, PERMISSIONS.REPORTS_READ]);
  });

  it('never edits a system role, and refuses unknown codes and unknown roles', async () => {
    const repo = new FakeRoles();
    const pa = repo.seed('PLATFORM_ADMINISTRATOR', Object.values(PERMISSIONS));
    const owner = repo.seed('Owner', Object.values(PERMISSIONS));
    const analyst = repo.seed('ANALYST', [PERMISSIONS.REPORTS_READ]);
    const uc = new RoleManagementUseCase(repo);
    expect(await uc.replacePermissions({ roleId: pa, permissionCodes: [], actorId })).toMatchObject({ ok: false, code: 'SYSTEM_ROLE', status: 409 });
    expect(await uc.replacePermissions({ roleId: owner, permissionCodes: [], actorId })).toMatchObject({ ok: false, code: 'SYSTEM_ROLE', status: 409 });
    expect(await uc.replacePermissions({ roleId: analyst, permissionCodes: ['reports.everything'], actorId })).toMatchObject({ ok: false, code: 'UNKNOWN_PERMISSION' });
    expect(await uc.replacePermissions({ roleId: 'nope', permissionCodes: [], actorId })).toMatchObject({ ok: false, code: 'NOT_FOUND', status: 404 });
  });

  it('refuses to strip auth.manage or roles.manage when no other active user would still hold it', async () => {
    const repo = new FakeRoles();
    const sec = repo.seed('SECURITY_ADMIN', [PERMISSIONS.AUTH_MANAGE, PERMISSIONS.ROLES_MANAGE, PERMISSIONS.AUDIT_READ], 1);
    repo.holders.set('u1', { active: true, roleIds: [sec] });
    const uc = new RoleManagementUseCase(repo);
    const stripped = await uc.replacePermissions({ roleId: sec, permissionCodes: [PERMISSIONS.AUDIT_READ], actorId });
    expect(stripped).toMatchObject({ ok: false, code: 'LAST_ACCESS_MANAGER', status: 409 });
    expect(repo.roles.get(sec)!.permissionCodes).toContain(PERMISSIONS.AUTH_MANAGE);

    // Another ACTIVE holder through a different role makes the same edit safe.
    const owner = repo.seed('Owner', Object.values(PERMISSIONS), 1);
    repo.holders.set('u2', { active: true, roleIds: [owner] });
    const allowed = await uc.replacePermissions({ roleId: sec, permissionCodes: [PERMISSIONS.AUDIT_READ], actorId });
    expect(allowed.ok).toBe(true);
  });

  it('an INACTIVE holder of the code elsewhere does not count', async () => {
    const repo = new FakeRoles();
    const sec = repo.seed('SECURITY_ADMIN', [PERMISSIONS.AUTH_MANAGE], 1);
    const owner = repo.seed('Owner', Object.values(PERMISSIONS), 1);
    repo.holders.set('u1', { active: true, roleIds: [sec] });
    repo.holders.set('u2', { active: false, roleIds: [owner] });
    const uc = new RoleManagementUseCase(repo);
    expect(await uc.replacePermissions({ roleId: sec, permissionCodes: [], actorId })).toMatchObject({ ok: false, code: 'LAST_ACCESS_MANAGER' });
  });
});

describe('RoleManagementUseCase — deleting roles', () => {
  it('deletes only a non-system role nobody holds', async () => {
    const repo = new FakeRoles();
    const held = repo.seed('SUPPORT_OPERATOR', [PERMISSIONS.ORDERS_READ], 2);
    const empty = repo.seed('TEMP_ROLE', [PERMISSIONS.ORDERS_READ], 0);
    const pa = repo.seed('PLATFORM_ADMINISTRATOR', Object.values(PERMISSIONS), 0);
    const uc = new RoleManagementUseCase(repo);
    expect(await uc.deleteRole({ roleId: held, actorId })).toMatchObject({ ok: false, code: 'ROLE_IN_USE', status: 409 });
    expect(await uc.deleteRole({ roleId: pa, actorId })).toMatchObject({ ok: false, code: 'SYSTEM_ROLE', status: 409 });
    expect(await uc.deleteRole({ roleId: 'missing', actorId })).toMatchObject({ ok: false, code: 'NOT_FOUND', status: 404 });
    expect((await uc.deleteRole({ roleId: empty, actorId })).ok).toBe(true);
    expect(repo.roles.has(empty)).toBe(false);
  });

  it('the catalogue is exactly the code registry, grouped by module', () => {
    const uc = new RoleManagementUseCase(new FakeRoles());
    const cat = uc.catalogue();
    expect(cat.map((c) => c.code)).toEqual(Array.from(new Set(Object.values(PERMISSIONS))).sort());
    expect(cat.find((c) => c.code === 'analytics.alerts.manage')?.area).toBe('analytics');
  });
});
