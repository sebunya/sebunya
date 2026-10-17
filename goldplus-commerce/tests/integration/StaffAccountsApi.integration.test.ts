import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { Fixtures } from './helpers/fixtures';

/**
 * Staff accounts through the REAL Hono app on REAL PostgreSQL (2026-10-17); only sign-in is stubbed. The list
 * holds staff only; a customer is found on purpose; a first role needs a reason and is audited as such; a
 * customer's sign-in is deactivated from their own page through the same audited action.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

vi.mock('../../apps/api/src/interfaces/http/middleware/auth', async () => {
  const { PERMISSIONS } = await import('../../packages/shared/src/permissions');
  return {
    authMiddleware: async (c: any, next: any) => {
      const id = (c.req.header('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
      if (!id) return c.json({ success: false, error: { code: 'UNAUTHENTICATED' } }, 401);
      c.set('user', { id, email: `${id}@itest`, permissions: Object.values(PERMISSIONS) });
      await next();
    },
  };
});

suite('staff accounts API (real PostgreSQL, real app)', () => {
  let app: any; let raw: any; let admin: string; let fx: Fixtures;
  const tag = Date.now().toString(36);
  const J = { 'Content-Type': 'application/json' };
  const users: string[] = []; const roleIds: string[] = [];
  let shopper: string; let staff: string; const roleName = `IT_DESK_${tag}`.toUpperCase();
  const get = (p: string) => app.request(p, { headers: { Authorization: `Bearer ${admin}` } });
  const post = (p: string, body: unknown) => app.request(p, { method: 'POST', headers: { ...J, Authorization: `Bearer ${admin}` }, body: JSON.stringify(body) });

  beforeAll(async () => {
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 2, onnotice: () => undefined });
    app = (await import('../../apps/api/src/interfaces/http/app')).default;
    fx = new Fixtures(raw);
    admin = await fx.user();
    const [r] = await raw`insert into roles (name) values (${roleName}) returning id`; roleIds.push(r.id);
    const mk = async (n: string) => { const [u] = await raw`insert into users (email, password_hash, is_active) values (${`${n}-${tag}@it.test`}, 'x', true) returning id`; users.push(u.id); return u.id as string; };
    shopper = await mk('buyer'); staff = await mk('packer');
    await raw`insert into user_roles (user_id, role_id) values (${staff}, ${r.id})`;
    await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status, user_id)
      values (${'st' + tag}, 'IT', '0772000000', 'Kira', 'Adr', 1, 0, 1, 'received', 'unpaid', ${shopper})`;
  }, 60_000);

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from audit_logs where entity_id = any(${users})`.catch(() => undefined);
    await raw`delete from orders where user_id = any(${users})`;
    await raw`delete from user_roles where user_id = any(${users})`;
    await raw`delete from users where id = any(${users})`;
    await raw`delete from roles where id = any(${roleIds})`;
    await fx?.cleanup();
    await raw.end({ timeout: 5 });
  });

  it('lists staff, not the customer, and counts customers', async () => {
    const res = await get('/admin/users');
    expect(res.status).toBe(200);
    const ids = new Set(((await res.json()).data as any[]).map((u) => u.id));
    expect(ids.has(staff)).toBe(true);
    expect(ids.has(shopper)).toBe(false);
    expect(Number(res.headers.get('X-Shopper-Accounts'))).toBeGreaterThanOrEqual(1);
  });

  it('finds the customer on purpose, by email or by id, as a customer with their orders', async () => {
    const byEmail = await (await get(`/admin/users/lookup?email=${encodeURIComponent(`BUYER-${tag}@it.test`)}`)).json();
    expect(byEmail.data).toMatchObject({ id: shopper, kind: 'SHOPPER', orderCount: 1 });
    expect((await (await get(`/admin/users/account/${staff}`)).json()).data).toMatchObject({ kind: 'STAFF', roleNames: [roleName] });
    expect((await get(`/admin/users/lookup?email=nobody-${tag}@it.test`)).status).toBe(404);
  });

  it('a first role without a reason is refused; with one it is given and audited as first back-office access', async () => {
    const bare = await post(`/admin/users/${shopper}/roles`, { roleName });
    expect(bare.status).toBe(400);
    expect((await bare.json()).error.code).toBe('REASON_REQUIRED');
    expect((await raw`select count(*)::int as n from user_roles where user_id = ${shopper}`)[0].n).toBe(0);
    const ok = await post(`/admin/users/${shopper}/roles`, { roleName, reason: 'Sarah, new packer, confirmed by phone' });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toEqual({ outcome: 'ASSIGNED', firstAccess: true });
    const [a] = await raw`select action, new_state from audit_logs where entity_id = ${shopper} order by created_at desc limit 1`;
    expect(a.action).toBe('ADMIN_FIRST_BACK_OFFICE_ACCESS_GRANTED');
    expect(JSON.stringify(a.new_state)).toContain('confirmed by phone');
    const ids = new Set((((await (await get('/admin/users')).json()).data) as any[]).map((u) => u.id));
    expect(ids.has(shopper)).toBe(true);
  });

  it('a customer sign-in is deactivated with a reason and reactivated', async () => {
    const other = (await raw`insert into users (email, password_hash, is_active) values (${`other-${tag}@it.test`}, 'x', true) returning id`)[0].id; users.push(other);
    expect((await post(`/admin/users/${other}/active`, { active: false })).status).toBeGreaterThanOrEqual(400);
    expect((await post(`/admin/users/${other}/active`, { active: false, reason: 'Fraudulent orders reported' })).status).toBe(200);
    expect((await raw`select is_active from users where id = ${other}`)[0].is_active).toBe(false);
    expect((await post(`/admin/users/${other}/active`, { active: true })).status).toBe(200);
  });
});
