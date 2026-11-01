import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AdminUserManagementUseCase, FIRST_ACCESS_REASON_MIN } from '../../apps/api/src/application/use-cases/identity/AdminUserManagementUseCase';
import { ListAdminUsersUseCase } from '../../apps/api/src/application/use-cases/admin/ListAdminUsersUseCase';

/**
 * Staff and shoppers share one users table (2026-10-17). The Staff accounts page lists staff only; turning a
 * shopper into staff is a deliberate, reasoned, audited step — never a role picker beside every customer.
 */
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

function repoWith(roles: Record<string, string[]>) {
  const held = new Map(Object.entries(roles).map(([k, v]) => [k, new Set(v)]));
  return {
    held,
    roleExists: async (r: string) => ['SUPPORT_OPERATOR', 'ANALYST', 'PLATFORM_ADMINISTRATOR'].includes(r),
    roleCount: async (u: string) => held.get(u)?.size ?? 0,
    assignRole: async (u: string, r: string) => { const s = held.get(u) ?? new Set<string>(); s.add(r); held.set(u, s); return true; },
    rolePermissionCodes: async () => [],
    createGrantRequest: async () => ({ id: 'req-1' }),
  } as any;
}

describe('a first back-office role turns a customer into staff: never a stray click', () => {
  it('refuses a first role without a reason, and records it as a first grant with one', async () => {
    const repo = repoWith({ admin: ['PLATFORM_ADMINISTRATOR'], shopper: [] });
    const uc = new AdminUserManagementUseCase(repo, { hash: async () => 'h' } as any);
    const bare = await uc.grantRole({ userId: 'shopper', roleName: 'SUPPORT_OPERATOR', actorId: 'admin' });
    expect(bare).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    expect((bare as any).message).toMatch(/shopper account/);
    expect(await uc.grantRole({ userId: 'shopper', roleName: 'SUPPORT_OPERATOR', actorId: 'admin', reason: 'short' })).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
    expect(repo.held.get('shopper')!.size).toBe(0);
    const ok = await uc.grantRole({ userId: 'shopper', roleName: 'SUPPORT_OPERATOR', actorId: 'admin', reason: 'Sarah, new packer at the shop' });
    expect(ok).toEqual({ ok: true, value: { outcome: 'ASSIGNED', firstAccess: true } });
    expect(FIRST_ACCESS_REASON_MIN).toBe(10);
  });
  it('a second role for existing staff needs no reason and is not a first grant', async () => {
    const repo = repoWith({ admin: ['PLATFORM_ADMINISTRATOR'], staff: ['SUPPORT_OPERATOR'] });
    const uc = new AdminUserManagementUseCase(repo, { hash: async () => 'h' } as any);
    expect(await uc.grantRole({ userId: 'staff', roleName: 'ANALYST', actorId: 'admin' })).toEqual({ ok: true, value: { outcome: 'ASSIGNED', firstAccess: false } });
  });
  it('the route audits a first grant under its own action, with the reason', () => {
    const route = read('apps/api/src/interfaces/http/routes/admin/users.ts');
    expect(route).toContain("action: outcome.value.firstAccess ? 'ADMIN_FIRST_BACK_OFFICE_ACCESS_GRANTED' : 'ADMIN_ROLE_GRANTED'");
    expect(route).toMatch(/routes\.get\('\/lookup', requirePermissions\(\[PERMISSIONS\.AUTH_MANAGE\]\)/);
  });
});

describe('the staff list holds staff only; shoppers are counted and looked up on purpose', () => {
  const at = new Date('2026-10-17T10:00:00Z');
  const uc = new ListAdminUsersUseCase({
    findStaff: async () => [{ id: 's1', email: 'admin@shopgoldplus.com', phone: null, isActive: true, roleNames: ['Owner'], createdAt: at }],
    countShopperAccounts: async () => 7,
    findAccountByEmail: async (e: string) => (e === 'buyer@example.com'
      ? { id: 'c1', email: e, phone: null, isActive: true, roleNames: [], createdAt: at, orderCount: 3, hasPendingGrant: false }
      : e === 'pending@example.com' ? { id: 'c2', email: e, phone: null, isActive: true, roleNames: [], createdAt: at, orderCount: 0, hasPendingGrant: true } : null),
  });
  it('lists staff, counts shoppers, and tells a shopper from staff', async () => {
    expect((await uc.execute()).map((u) => u.email)).toEqual(['admin@shopgoldplus.com']);
    expect(await uc.shopperAccountCount()).toBe(7);
    expect(await uc.lookup('buyer@example.com')).toMatchObject({ kind: 'SHOPPER', orderCount: 3 });
    expect(await uc.lookup('pending@example.com')).toMatchObject({ kind: 'STAFF', hasPendingGrant: true });
    expect(await uc.lookup('nobody@example.com')).toBeNull();
  });
  it('the page: plain words, no role picker for customers, a confirmed and reasoned first grant', () => {
    const page = read('apps/web/src/pages/admin/users/index.astro');
    expect(page).toContain('Staff accounts');
    expect(page).not.toMatch(/Email Handle|Contact Trace|Assigned Scopes|Execute console seeding|System Users/);
    expect(page).toContain("They belong to customers, who have no back-office access.");
    // Most customer accounts have no Customer DNA profile (prod 2026-10-17: 4 of 7), so blocking one must not
    // depend on it: the exact-email lookup offers it for any customer account.
    expect(page).toMatch(/Block this customer's sign-in/);
    expect(page).toMatch(/<input type="hidden" name="action" value="set-active" \/>\s*<input type="hidden" name="id" value=\{lookup\.id\} \/>/);
    expect(page).toMatch(/is a <strong>customer account<\/strong>/);
    expect(page).toMatch(/name="reason" required minlength="10"/);
    expect(page).toMatch(/<input type="checkbox" required/);
    expect(page).toContain('It is their last role: they lose all back-office access');
    // A pending full-access request may be a NEW staff member's (created with that role), not a customer's.
    expect(page).toContain('This account has no back-office access yet: approving gives it full access (check who it is; it may be a customer');
    expect(page).not.toContain("(it is a customer's account): approving");
    const cust = read('apps/web/src/pages/admin/customer-dna/[id].astro');
    expect(cust).toContain('action === "set-account-active"');
    expect(cust).toMatch(/\/admin\/users\/account\/\$\{encodeURIComponent\(profile\.accountUserId\)\}/);
    expect(cust).toContain('It has no back-office access.');
  });
  it('the query has no recency cap: an old administrator never falls off the list', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleAdminUserReadRepository.ts');
    expect(repo).not.toMatch(/limit: 200/);
    expect(repo).toMatch(/exists \(select 1 from user_roles ur where ur\.user_id = u\.id\)/);
    expect(repo).toMatch(/g\.status = 'PENDING'/);
  });
});
