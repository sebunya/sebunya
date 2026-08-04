import { describe, expect, it } from 'vitest';
import {
  AdminUserManagementUseCase,
  IAdminUserWriteRepository,
} from '../../apps/api/src/application/use-cases/identity/AdminUserManagementUseCase';

/**
 * §6 governance invariants: PLATFORM_ADMINISTRATOR is never granted in one step
 * (request → different-admin approval), the requester can never decide their own
 * request, an admin cannot self-revoke the full-admin role, passwords have a
 * floor, and lesser governance roles assign directly.
 */
class FakeRepo implements IAdminUserWriteRepository {
  users = new Map<string, { id: string; email: string }>();
  roles = new Map<string, Set<string>>(); // userId -> roleNames
  requests = new Map<string, { id: string; userId: string; roleName: string; status: string; requestedBy: string }>();
  private seq = 0;

  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async createUser(input: { email: string; phone: string | null; passwordHash: string }) {
    const user = { id: `u-${++this.seq}`, email: input.email };
    this.users.set(user.id, user);
    return user;
  }
  async assignRole(userId: string, roleName: string) {
    const set = this.roles.get(userId) ?? new Set();
    set.add(roleName);
    this.roles.set(userId, set);
    return true;
  }
  async revokeRole(userId: string, roleName: string) {
    return this.roles.get(userId)?.delete(roleName) ?? false;
  }
  async userHasRole(userId: string, roleName: string) {
    return this.roles.get(userId)?.has(roleName) ?? false;
  }
  async createGrantRequest(input: { userId: string; roleName: string; requestedBy: string; reason: string | null }) {
    const dupe = [...this.requests.values()].some(
      (r) => r.userId === input.userId && r.roleName === input.roleName && r.status === 'PENDING',
    );
    if (dupe) return null;
    const request = { id: `req-${++this.seq}`, userId: input.userId, roleName: input.roleName, status: 'PENDING', requestedBy: input.requestedBy };
    this.requests.set(request.id, request);
    return request;
  }
  async findGrantRequest(id: string) {
    return this.requests.get(id) ?? null;
  }
  async decideGrantRequest(id: string, fields: { status: 'APPROVED' | 'REJECTED'; decidedBy: string; reason: string | null }) {
    const request = this.requests.get(id)!;
    request.status = fields.status;
  }
  async listGrantRequests() {
    return [...this.requests.values()].map((r) => ({ ...r, requestedAt: new Date(0) }));
  }
}

const hasher = { hash: async (p: string) => `hashed:${p.length}` };
const setup = () => {
  const repo = new FakeRepo();
  return { repo, useCase: new AdminUserManagementUseCase(repo, hasher) };
};

describe('AdminUserManagementUseCase (§6 governance)', () => {
  it('creates a LEGAL_REVIEWER with direct role assignment', async () => {
    const { repo, useCase } = setup();
    const outcome = await useCase.createUser({
      email: 'Reviewer@ShopGoldPlus.com',
      initialPassword: 'a-strong-initial-secret',
      roleName: 'LEGAL_REVIEWER',
      actorId: 'admin-1',
    });
    expect(outcome).toMatchObject({ ok: true, value: { roleOutcome: 'ASSIGNED', email: 'reviewer@shopgoldplus.com' } });
    const userId = (outcome as any).value.userId;
    expect(await repo.userHasRole(userId, 'LEGAL_REVIEWER')).toBe(true);
  });

  it('PLATFORM_ADMINISTRATOR is never direct — creation yields a PENDING request', async () => {
    const { repo, useCase } = setup();
    const outcome = await useCase.createUser({
      email: 'second-admin@shopgoldplus.com',
      initialPassword: 'another-strong-secret!',
      roleName: 'PLATFORM_ADMINISTRATOR',
      actorId: 'admin-1',
    });
    expect(outcome).toMatchObject({ ok: true, value: { roleOutcome: 'PENDING_APPROVAL' } });
    const userId = (outcome as any).value.userId;
    expect(await repo.userHasRole(userId, 'PLATFORM_ADMINISTRATOR')).toBe(false);
    expect([...repo.requests.values()][0]).toMatchObject({ roleName: 'PLATFORM_ADMINISTRATOR', status: 'PENDING' });
  });

  it('maker/checker: the requester cannot decide their own grant; a different admin can', async () => {
    const { repo, useCase } = setup();
    await useCase.grantRole({ userId: 'u-x', roleName: 'PLATFORM_ADMINISTRATOR', actorId: 'admin-1' });
    const requestId = [...repo.requests.keys()][0];
    expect(await useCase.decideGrant({ requestId, decision: 'APPROVED', actorId: 'admin-1' }))
      .toMatchObject({ ok: false, code: 'MAKER_CHECKER', status: 403 });
    expect(await useCase.decideGrant({ requestId, decision: 'APPROVED', actorId: 'admin-2' }))
      .toMatchObject({ ok: true });
    expect(await repo.userHasRole('u-x', 'PLATFORM_ADMINISTRATOR')).toBe(true);
    // Already decided: refused.
    expect(await useCase.decideGrant({ requestId, decision: 'REJECTED', actorId: 'admin-3' }))
      .toMatchObject({ ok: false, code: 'ALREADY_DECIDED' });
  });

  it('duplicate pending requests are refused', async () => {
    const { useCase } = setup();
    await useCase.grantRole({ userId: 'u-x', roleName: 'PLATFORM_ADMINISTRATOR', actorId: 'admin-1' });
    expect(await useCase.grantRole({ userId: 'u-x', roleName: 'PLATFORM_ADMINISTRATOR', actorId: 'admin-1' }))
      .toMatchObject({ ok: false, code: 'DUPLICATE_PENDING', status: 409 });
  });

  it('an admin cannot revoke their own PLATFORM_ADMINISTRATOR (lockout guard)', async () => {
    const { repo, useCase } = setup();
    await repo.assignRole('admin-1', 'PLATFORM_ADMINISTRATOR');
    expect(await useCase.revokeRole({ userId: 'admin-1', roleName: 'PLATFORM_ADMINISTRATOR', actorId: 'admin-1' }))
      .toMatchObject({ ok: false, code: 'SELF_LOCKOUT', status: 403 });
    // A different admin may revoke it.
    expect(await useCase.revokeRole({ userId: 'admin-1', roleName: 'PLATFORM_ADMINISTRATOR', actorId: 'admin-2' }))
      .toMatchObject({ ok: true, value: { revoked: true } });
  });

  it('refuses weak passwords, unknown roles and duplicate emails', async () => {
    const { useCase } = setup();
    expect(await useCase.createUser({ email: 'a@b.co', initialPassword: 'short', roleName: 'LEGAL_REVIEWER', actorId: 'a' }))
      .toMatchObject({ ok: false, code: 'WEAK_PASSWORD' });
    expect(await useCase.createUser({ email: 'reviewer@b.co', initialPassword: 'reviewer-password-1', roleName: 'LEGAL_REVIEWER', actorId: 'a' }))
      .toMatchObject({ ok: false, code: 'WEAK_PASSWORD' }); // contains email local part
    expect(await useCase.createUser({ email: 'a@b.co', initialPassword: 'a-strong-initial-secret', roleName: 'NOT_A_ROLE', actorId: 'a' }))
      .toMatchObject({ ok: false, code: 'UNKNOWN_ROLE' });
    const first = await useCase.createUser({ email: 'a@b.co', initialPassword: 'a-strong-initial-secret', roleName: 'LEGAL_REVIEWER', actorId: 'a' });
    expect(first.ok).toBe(true);
    expect(await useCase.createUser({ email: 'A@b.co', initialPassword: 'a-strong-initial-secret2', roleName: 'LEGAL_REVIEWER', actorId: 'a' }))
      .toMatchObject({ ok: false, code: 'DUPLICATE_EMAIL', status: 409 });
  });
});
