import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** The staff list against real PostgreSQL (2026-10-17): role holders and pending grants only, shoppers counted. */
const URL_ = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL_ && process.env.DATABASE_URL ? describe : describe.skip;

suite('staff accounts versus shopper accounts (real PostgreSQL)', () => {
  let raw: any;
  const ids: string[] = [];
  const roleIds: string[] = [];
  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL_ as string, { max: 2, onnotice: () => undefined });
  });
  afterAll(async () => {
    if (ids.length) {
      await raw`delete from role_grant_requests where user_id = any(${ids})`;
      await raw`delete from orders where user_id = any(${ids})`;
      await raw`delete from user_roles where user_id = any(${ids})`;
      await raw`delete from users where id = any(${ids})`;
    }
    if (roleIds.length) await raw`delete from roles where id = any(${roleIds})`;
    await raw?.end({ timeout: 5 });
  });
  it('an old staff member is listed, a shopper is not (but is counted and found by email with their orders)', async () => {
    const tag = Date.now().toString(36);
    const mk = async (name: string, createdDaysAgo: number) => {
      const [u] = await raw`insert into users (email, password_hash, is_active, created_at) values (${`${name}-${tag}@it.test`}, 'x', true, now() - ${createdDaysAgo + ' days'}::interval) returning id`;
      ids.push(u.id); return u.id as string;
    };
    const oldStaff = await mk('oldstaff', 900);
    const shopper = await mk('Shopper', 1);
    const pending = await mk('pending', 2);
    const [role] = await raw`insert into roles (name) values (${'IT_STAFF_' + tag}) returning id`;
    roleIds.push(role.id);
    await raw`insert into user_roles (user_id, role_id) values (${oldStaff}, ${role.id})`;
    await raw`insert into role_grant_requests (user_id, role_name, requested_by, status) values (${pending}, 'PLATFORM_ADMINISTRATOR', ${oldStaff}, 'PENDING')`;
    await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status, user_id)
      values (${'sa' + tag}, 'IT', '0772000000', 'Kira', 'Adr', 1, 0, 1, 'received', 'unpaid', ${shopper})`;
    const { DrizzleAdminUserReadRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdminUserReadRepository');
    const repo = new DrizzleAdminUserReadRepository();
    const staff = await repo.findStaff();
    const staffIds = new Set(staff.map((s) => s.id));
    expect(staffIds.has(oldStaff) && staffIds.has(pending)).toBe(true);
    expect(staffIds.has(shopper)).toBe(false);
    expect(staff.find((s) => s.id === oldStaff)!.roleNames.length).toBe(1);
    expect(await repo.countShopperAccounts()).toBeGreaterThanOrEqual(1);
    const found = await repo.findAccountByEmail(`  shopper-${tag}@IT.test `);
    expect(found).toMatchObject({ id: shopper, roleNames: [], orderCount: 1, hasPendingGrant: false });
    const { DrizzleAdminUserWriteRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAdminUserWriteRepository');
    const w = new DrizzleAdminUserWriteRepository();
    expect(await w.roleCount(shopper)).toBe(0);
    expect(await w.roleCount(oldStaff)).toBe(1);
  });
});
