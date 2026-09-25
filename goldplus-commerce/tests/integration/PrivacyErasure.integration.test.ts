import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Privacy erasure on REAL PostgreSQL. The unit test only reads the SQL text;
 * this runs the whole transaction so a NOT NULL, CHECK or type mismatch in any
 * of the tables it touches fails here and not on a customer's request.
 *
 * Set COMMERCE_TEST_DATABASE_URL to a MIGRATED database. Skips otherwise.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('privacy erasure (real PostgreSQL)', () => {
  let raw: any;
  let eraser: any;
  const userIds: string[] = [];
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const seedCustomer = async (label: string) => {
    const email = `erase-${label}-${tag}@e.com`;
    const phone = `07721${Math.floor(10000 + Math.random() * 89999)}`;
    const [u] = await raw`insert into users (email, phone, password_hash) values (${email}, ${phone}, 'x') returning id`;
    userIds.push(u.id);
    const [o] = await raw`
      insert into orders (order_number, user_id, customer_name, customer_phone, customer_email, delivery_area, delivery_address,
                          delivery_location, subtotal_amount, delivery_fee, total_amount, status, payment_status)
      values (${`e${label}${tag}`.slice(0, 20)}, ${u.id}, 'Jane Customer', ${phone}, ${email}, 'Kla', 'Plot 1 Street',
              ${raw.json({ district: 'Kampala', parish: 'X' })}, 1000, 0, 1000, 'completed', 'paid') returning id`;
    await raw`insert into notification_attempts (channel, recipient, template, status, related_entity, related_entity_id)
              values ('sms', ${phone}, 'ORDER_PAYMENT_SUCCESS', 'SENT', 'order', ${o.id})`;
    const [q] = await raw`insert into quote_requests (customer_name, email, phone, product_name, quantity)
              values ('Jane', ${email}, ${phone}, 'Battery', '2') returning id`;
    await raw`insert into addresses (user_id, label, recipient_name, phone, district, area_details)
              values (${u.id}, 'Home', 'Jane', ${phone}, 'Kampala', 'Near the market')`;
    await raw`insert into auth_sessions (user_id, family_id, refresh_hash, jti, access_expires_at, refresh_expires_at)
              values (${u.id}, gen_random_uuid(), ${(`h${tag}${label}`).padEnd(64, "0")}, gen_random_uuid(), now() + interval '1 hour', now() + interval '1 day')`;
    const [r] = await raw`insert into privacy_requests (reference, user_id, kind)
              values (${`PR${label}${tag}`.slice(0, 16)}, ${u.id}, ${label === 'del' ? 'DELETE_ACCOUNT' : 'ANONYMISE_HISTORY'}) returning id`;
    return { userId: u.id, orderId: o.id, quoteId: q.id, requestId: r.id, phone, email };
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    const repo = await import('../../apps/api/src/infrastructure/first-party/DrizzlePrivacyRepositories');
    const adapters = await import('../../apps/api/src/infrastructure/first-party/FirstPartyAdapters');
    eraser = new repo.DrizzlePersonalDataEraser(new adapters.HmacIdentifierHasher('p'.repeat(40)));
  });

  afterAll(async () => {
    if (!raw) return;
    if (userIds.length) {
      await raw`delete from privacy_requests where user_id in ${raw(userIds)}`;
      await raw`delete from auth_sessions where user_id in ${raw(userIds)}`;
      await raw`delete from addresses where user_id in ${raw(userIds)}`;
      await raw`delete from notification_attempts where related_entity = 'order' and related_entity_id in (select id from orders where user_id in ${raw(userIds)})`;
      await raw`delete from orders where user_id in ${raw(userIds)}`;
      await raw`delete from users where id in ${raw(userIds)}`;
    }
    await raw`delete from quote_requests where customer_name = ${'[removed]'} and updated_at > now() - interval '1 hour' and email = ''`.catch(() => {});
    await raw.end();
  });

  it('ANONYMISE_HISTORY blanks order, message log and quote contacts; the account stays', async () => {
    const c = await seedCustomer('anon');
    const res = await eraser.erase({ userId: c.userId, kind: 'ANONYMISE_HISTORY', requestId: c.requestId, actorId: c.userId, reason: 'test' });
    expect(res.completed).toBe(true);

    const [o] = await raw`select customer_phone, customer_email, customer_name, delivery_location from orders where id = ${c.orderId}`;
    expect(o.customer_phone).toBe('');
    expect(o.customer_email).toBeNull();
    expect(o.customer_name).not.toBe('Jane Customer');
    expect(o.delivery_location).toEqual({ district: 'Kampala', removed: true });
    const [n] = await raw`select recipient from notification_attempts where related_entity_id = ${c.orderId}`;
    expect(n.recipient).toBe('removed');
    const [q] = await raw`select email, phone from quote_requests where id = ${c.quoteId}`;
    expect(q).toEqual({ email: '', phone: '' });
    const [u] = await raw`select email, is_active from users where id = ${c.userId}`;
    expect(u).toEqual({ email: c.email, is_active: true });
    const [r] = await raw`select status, result from privacy_requests where id = ${c.requestId}`;
    expect(r.status).toBe('COMPLETED');
    expect(r.result.counts.orders).toBe(1);
  });

  it('DELETE_ACCOUNT also closes the account, blanks addresses and revokes sessions', async () => {
    const c = await seedCustomer('del');
    const res = await eraser.erase({ userId: c.userId, kind: 'DELETE_ACCOUNT', requestId: c.requestId, actorId: c.userId, reason: 'test' });
    expect(res.completed).toBe(true);

    const [u] = await raw`select email, phone, password_hash, is_active from users where id = ${c.userId}`;
    expect(u.email).not.toBe(c.email);
    expect(u.phone).toBeNull();
    expect(u.password_hash).toBeNull();
    expect(u.is_active).toBe(false);
    const [a] = await raw`select phone, deleted_at from addresses where user_id = ${c.userId}`;
    expect(a.phone).toBe('');
    expect(a.deleted_at).not.toBeNull();
    const [s] = await raw`select revoked_at from auth_sessions where user_id = ${c.userId}`;
    expect(s.revoked_at).not.toBeNull();
  });

  it('a second erase of the same request changes nothing', async () => {
    const [r] = await raw`select id, user_id from privacy_requests where user_id = ${userIds[0]}`;
    const res = await eraser.erase({ userId: r.user_id, kind: 'ANONYMISE_HISTORY', requestId: r.id, actorId: r.user_id, reason: 'again' });
    expect(res.completed).toBe(false);
  });
});
