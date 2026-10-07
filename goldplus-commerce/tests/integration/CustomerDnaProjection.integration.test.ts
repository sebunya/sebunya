import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Fixtures } from './helpers/fixtures';

/**
 * Customer DNA against a real PostgreSQL (2026-10-07 review): purchases only,
 * stages that move with time, honest cart abandonment, admin search by email
 * or phone, stage counts and the nightly re-projection queue.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('customer DNA projection (real PostgreSQL)', () => {
  let raw: any;
  let reg: any;
  let fx: Fixtures;
  let productId: string;
  const userIds: string[] = [];
  const profileIds: string[] = [];

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL as string, { max: 2, onnotice: () => undefined });
    const { DrizzleCustomerProfileRepository, DrizzleCustomerIdentityRepository, DrizzleCustomerFeatureRepository, DrizzleCustomerLifecycleRepository } =
      await import('../../apps/api/src/infrastructure/db/repositories/DrizzleCustomerDnaRepositories');
    const { DrizzleCustomerSignalReader } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleCustomerSignalReader');
    const { ProjectCustomerProfileUseCase, ReprojectStaleProfilesUseCase } = await import('../../apps/api/src/application/use-cases/customer-dna/CustomerDnaUseCases');
    const profiles = new DrizzleCustomerProfileRepository();
    const project = new ProjectCustomerProfileUseCase(
      profiles, new DrizzleCustomerIdentityRepository(), new DrizzleCustomerFeatureRepository(), new DrizzleCustomerLifecycleRepository(),
      new DrizzleCustomerSignalReader(), { async save() { return undefined; } } as never,
    );
    reg = { profiles, project, reproject: new ReprojectStaleProfilesUseCase(profiles, project) };
    fx = new Fixtures(raw);
    productId = (await fx.product()).id;
  });

  afterAll(async () => {
    if (!raw) return;
    if (profileIds.length) {
      await raw`delete from customer_feature_snapshots where canonical_customer_id = any(${profileIds})`;
      await raw`delete from customer_lifecycle_snapshots where canonical_customer_id = any(${profileIds})`;
      await raw`delete from customer_profiles where canonical_customer_id = any(${profileIds})`;
    }
    if (userIds.length) {
      await raw`delete from cart_items where cart_id in (select id from carts where user_id = any(${userIds}))`;
      await raw`delete from carts where user_id = any(${userIds})`;
      await raw`delete from orders where user_id = any(${userIds})`;
      await raw`delete from users where id = any(${userIds})`;
    }
    await fx?.cleanup();
    await raw.end();
  });

  const seedCustomer = async (phone: string) => {
    const email = `dna-${crypto.randomUUID().slice(0, 8)}@example.com`;
    const [u] = await raw`insert into users (email, phone, password_hash) values (${email}, ${phone}, 'h') returning id`;
    userIds.push(u.id);
    const [p] = await raw`insert into customer_profiles (account_user_id) values (${u.id}) returning canonical_customer_id as id`;
    profileIds.push(p.id);
    return { userId: u.id as string, profileId: p.id as string, email };
  };
  const seedOrder = async (userId: string, o: { daysAgo: number; status?: string; paymentStatus?: string; method?: string; total?: number }) => {
    const on = `dna${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.slice(0, 20);
    await raw`insert into orders (order_number, user_id, customer_name, customer_phone, delivery_area, delivery_address,
      subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method, created_at, updated_at)
      values (${on}, ${userId}, 'DNA', '0700000009', 'Kla', 'Adr', ${o.total ?? 100000}, 0, ${o.total ?? 100000},
        ${o.status ?? 'delivered'}, ${o.paymentStatus ?? 'paid'}, ${o.method ?? 'pesapal'},
        now() - ${o.daysAgo + ' days'}::interval, now() - ${o.daysAgo + ' days'}::interval)`;
  };
  const profileRow = async (id: string) => (await raw`select primary_lifecycle_stage as stage, profile_version as v, value_flags from customer_profiles where canonical_customer_id = ${id}`)[0];

  it('counts purchases only: an unpaid checkout leaves a PROSPECT', async () => {
    const c = await seedCustomer(`0772${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`);
    await seedOrder(c.userId, { daysAgo: 3, status: 'received', paymentStatus: 'unpaid' });
    await reg.project.execute({ canonicalCustomerId: c.profileId, actorId: 'test' });
    expect((await profileRow(c.profileId)).stage).toBe('PROSPECT');
    const [f] = await raw`select features from customer_feature_snapshots where canonical_customer_id = ${c.profileId} order by source_version desc limit 1`;
    const feats = typeof f.features === 'string' ? JSON.parse(f.features) : f.features; // driver-encoded jsonb
    expect(feats.find((x: any) => x.key === 'order_count').value).toBe(0);
  });

  it('moves the stage with time alone, and a re-check with nothing new keeps the version', async () => {
    const c = await seedCustomer(`0773${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`);
    for (const d of [200, 150, 100, 40]) await seedOrder(c.userId, { daysAgo: d });
    const now = new Date();
    await reg.project.execute({ canonicalCustomerId: c.profileId, actorId: 'test', now });
    const first = await profileRow(c.profileId);
    expect(first.stage).toBe('ACTIVE');
    // Same data, same day: nothing changes, no new version.
    const again = await reg.project.execute({ canonicalCustomerId: c.profileId, actorId: 'test', now });
    expect(again.advanced).toBe(false);
    expect((await profileRow(c.profileId)).v).toBe(first.v);
    // 40 days later with no new order: AT_RISK, a new version.
    const later = await reg.project.execute({ canonicalCustomerId: c.profileId, actorId: 'test', now: new Date(now.getTime() + 40 * 86_400_000) });
    expect(later.advanced).toBe(true);
    expect((await profileRow(c.profileId)).stage).toBe('AT_RISK');
    const [lc] = await raw`select stage from customer_lifecycle_snapshots where canonical_customer_id = ${c.profileId} order by computed_at desc limit 1`;
    expect(lc.stage).toBe('AT_RISK');
  });

  it('a customer with value flags is not re-versioned when nothing changed', async () => {
    const c = await seedCustomer(`0776${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`);
    await seedOrder(c.userId, { daysAgo: 5, total: 2_500_000 });
    const now = new Date();
    expect((await reg.project.execute({ canonicalCustomerId: c.profileId, actorId: 'test', now })).advanced).toBe(true);
    const flags = (await profileRow(c.profileId)).value_flags;
    expect(typeof flags === 'string' ? JSON.parse(flags) : flags).toEqual(['HIGH_VALUE']);
    expect((await reg.project.execute({ canonicalCustomerId: c.profileId, actorId: 'test', now })).advanced).toBe(false);
  });

  it('a cart is abandoned only if it had items and was left for a day', async () => {
    const c = await seedCustomer(`0774${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`);
    const [old] = await raw`insert into carts (user_id, updated_at) values (${c.userId}, now() - interval '3 days') returning id`;
    await raw`insert into cart_items (cart_id, product_id, quantity) values (${old.id}, ${productId}, 1)`;
    await raw`insert into carts (user_id, updated_at) values (${c.userId}, now() - interval '3 days')`; // empty
    const [fresh] = await raw`insert into carts (user_id) values (${c.userId}) returning id`;           // being filled now
    await raw`insert into cart_items (cart_id, product_id, quantity) values (${fresh.id}, ${productId}, 1)`;
    const { DrizzleCustomerSignalReader } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleCustomerSignalReader');
    const s = await new DrizzleCustomerSignalReader().readSignals({ accountUserId: c.userId, identifierKeys: [] });
    expect(s.cartAbandonments).toBe(1); // only the old cart with an item
    expect(s.searches).toBeNull();
  });

  it('finds a customer by email or by phone in any format; lists stage counts; queues the oldest', async () => {
    const phone = `0775${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
    const c = await seedCustomer(phone);
    await seedOrder(c.userId, { daysAgo: 2 });
    await reg.project.execute({ canonicalCustomerId: c.profileId, actorId: 'test' });
    expect((await reg.profiles.search(c.email.toUpperCase(), 10)).map((p: any) => p.canonicalCustomerId)).toContain(c.profileId);
    expect((await reg.profiles.search(`+256 ${phone.slice(1, 4)} ${phone.slice(4)}`, 10)).map((p: any) => p.canonicalCustomerId)).toContain(c.profileId);
    const counts = await reg.profiles.stageCounts();
    expect(counts.NEW_CUSTOMER).toBeGreaterThanOrEqual(1);
    await raw`update customer_profiles set computed_at = now() - interval '3 days' where canonical_customer_id = ${c.profileId}`;
    const queue = await reg.profiles.listForReprojection(5000, new Date(Date.now() - 20 * 3_600_000));
    expect(queue).toContain(c.profileId);
    const run = await reg.reproject.execute({ limit: 5000, olderThanHours: 20 });
    expect(run.failed).toBe(0);
    expect(await reg.profiles.listForReprojection(5000, new Date(Date.now() - 20 * 3_600_000))).not.toContain(c.profileId);
  });
});
