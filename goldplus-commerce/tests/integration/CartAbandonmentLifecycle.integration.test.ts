import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

/**
 * The hourly abandonment scan on real PostgreSQL (0129).
 *
 * Production failed this scan 227 times in a row from 2026-09-02: a cart that
 * had been abandoned, expired and re-classified could never be expired again,
 * because the unique index on (cart_id, status) refused a second EXPIRED row,
 * and one collision failed the single UPDATE that expires every OPEN row.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const describeIf = URL ? describe : describe.skip;

describeIf('cart abandonment lifecycle (real PostgreSQL)', () => {
  let raw: any; let repo: any; let uc: any; const cartIds: string[] = []; let productId: string;
  const H = 3600_000;
  const userIds: string[] = []; let hiddenProductId = '';
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  let ownCategoryId = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    // The snapshot predates 0129; apply it here so this suite is honest on its own.
    await raw.unsafe(readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/db/migrations/0129_cart_abandonment_open_uq_partial.sql'), 'utf8').replace(/--> statement-breakpoint/g, ''));
    // Its own category, removed afterwards: borrowing "the first category" left a stray row on an empty database.
    const catId = (await raw`insert into categories (name, slug) values ('T', ${'t-' + Date.now()}) returning id`)[0].id;
    ownCategoryId = catId;
    const sku = `AB-${Date.now().toString(36)}`;
    productId = (await raw`insert into products (sku, model_number, name, slug, category_id, price_ugx, active, approval_status) values (${sku}, ${sku}, 'Abandon Test', ${sku.toLowerCase()}, ${catId}, 10000, true, 'approved') returning id`)[0].id;
    const { DrizzleAbandonmentRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAbandonmentRepository');
    const { AbandonmentUseCase } = await import('../../apps/api/src/application/use-cases/abandonment/AbandonmentUseCase');
    repo = new DrizzleAbandonmentRepository();
    uc = (now: () => Date) => new AbandonmentUseCase(repo, { publish: async () => undefined }, now);
  });

  afterAll(async () => {
    if (!raw) return;
    if (cartIds.length) { await raw`delete from cart_abandonments where cart_id = any(${cartIds})`; await raw`delete from cart_items where cart_id = any(${cartIds})`; await raw`delete from carts where id = any(${cartIds})`; }
    if (userIds.length) { await raw`delete from orders where user_id = any(${userIds}) or order_number = ${`BC${tag}`.slice(0, 20)}`; await raw`delete from users where id = any(${userIds})`; }
    if (hiddenProductId) await raw`delete from products where id = ${hiddenProductId}`;
    if (productId) await raw`delete from products where id = ${productId}`;
    if (ownCategoryId) await raw`delete from categories where id = ${ownCategoryId}`;
    await raw.end();
  });

  const makeCart = async (updatedAt: Date, expiresAt: Date | null) => {
    const [c] = await raw`insert into carts (owner_kind, owner_id, updated_at, expires_at) values ('USER', ${'o-' + Math.random()}, ${updatedAt}, ${expiresAt}) returning id`;
    await raw`insert into cart_items (cart_id, product_id, quantity) values (${c.id}, ${productId}, 1)`;
    cartIds.push(c.id); return c.id as string;
  };
  const rows = (cartId: string) => raw`select status from cart_abandonments where cart_id = ${cartId} order by classified_at`;

  it('the production shape: abandoned, expired, re-abandoned, expired again — no collision, no stalled scan', async () => {
    const t0 = Date.now();
    const cart = await makeCart(new Date(t0 - 10 * H), new Date(t0 + 1 * H));
    // hour 0: classified OPEN
    let r = await uc(() => new Date(t0)).scan();
    expect((await rows(cart)).map((x: any) => x.status)).toEqual(['OPEN']);
    // cart expires; hour 2: OPEN -> EXPIRED
    await raw`update carts set expires_at = ${new Date(t0 + 1 * H)} where id = ${cart}`;
    r = await uc(() => new Date(t0 + 2 * H)).scan();
    expect(r.expired).toBeGreaterThanOrEqual(1);
    expect((await rows(cart)).map((x: any) => x.status)).toEqual(['EXPIRED']);
    // the customer comes back: cart alive again, then goes stale a second time
    await raw`update carts set expires_at = ${new Date(t0 + 30 * H)}, updated_at = ${new Date(t0 + 3 * H)} where id = ${cart}`;
    await uc(() => new Date(t0 + 12 * H)).scan();
    expect((await rows(cart)).map((x: any) => x.status)).toEqual(['EXPIRED', 'OPEN']);
    // and expires a second time: this UPDATE is what threw before 0129
    await raw`update carts set expires_at = ${new Date(t0 + 13 * H)} where id = ${cart}`;
    await expect(uc(() => new Date(t0 + 14 * H)).scan()).resolves.toMatchObject({ expired: expect.any(Number) });
    expect((await rows(cart)).map((x: any) => x.status)).toEqual(['EXPIRED', 'EXPIRED']);
  });

  it('an already-expired cart is not "newly abandoned" — no second lifecycle is manufactured', async () => {
    const t0 = Date.now();
    const cart = await makeCart(new Date(t0 - 10 * H), new Date(t0 - 1 * H)); // stale AND expired
    const r = await uc(() => new Date(t0)).scan();
    expect((await rows(cart)).length).toBe(0);
    void r;
  });

  it('still refuses a second OPEN row for the same cart', async () => {
    const t0 = Date.now();
    const cart = await makeCart(new Date(t0 - 10 * H), new Date(t0 + 5 * H));
    await uc(() => new Date(t0)).scan();
    const again = await repo.createOpen({ cartId: cart, ownerKind: 'anon', ownerId: 'x', itemCount: 1, subtotalUgx: 10000, lastActivityAt: new Date(t0 - 10 * H), expiresAt: null });
    expect(again).toBeNull();
    expect((await rows(cart)).map((x: any) => x.status)).toEqual(['OPEN']);
  });

  it('one stalled cart no longer blocks every other expiry (the whole-statement failure)', async () => {
    const t0 = Date.now();
    const a = await makeCart(new Date(t0 - 10 * H), new Date(t0 + 1 * H));
    const b = await makeCart(new Date(t0 - 10 * H), new Date(t0 + 1 * H));
    await uc(() => new Date(t0)).scan();
    await raw`update carts set expires_at = ${new Date(t0 + 1 * H)} where id in (${a}, ${b})`;
    const r = await uc(() => new Date(t0 + 2 * H)).scan();
    expect(r.expired).toBeGreaterThanOrEqual(2);
    expect((await rows(a))[0].status).toBe('EXPIRED');
    expect((await rows(b))[0].status).toBe('EXPIRED');
  });

  it('a basket touched after it was classified is closed as RESUMED, and its next idle period gets a row of its own', async () => {
    const t0 = Date.now();
    // updated_at carries milliseconds; last_activity_at goes through drizzle, which binds whole seconds. Compared
    // exactly, this untouched basket read as changed: closed as RESUMED, and never reminded.
    const cart = await makeCart(new Date(Math.floor((t0 - 10 * H) / 1000) * 1000 + 999), new Date(t0 + 100 * H));
    await uc(() => new Date(t0)).scan();
    expect((await rows(cart)).map((x: any) => x.status)).toEqual(['OPEN']);
    await uc(() => new Date(t0 + 1 * H)).scan();
    expect((await rows(cart)).map((x: any) => x.status)).toEqual(['OPEN']);
    // the shopper comes back
    await raw`update carts set updated_at = ${new Date(t0 + 2 * H)} where id = ${cart}`;
    const r = await uc(() => new Date(t0 + 3 * H)).scan();
    expect(r.resumed).toBeGreaterThanOrEqual(1);
    expect((await rows(cart)).map((x: any) => x.status)).toEqual(['RESUMED']); // idle 1 hour: not abandoned yet
    // idle past the threshold again: a second lifecycle, which the partial unique index allows
    await uc(() => new Date(t0 + 9 * H)).scan();
    expect((await rows(cart)).map((x: any) => x.status)).toEqual(['RESUMED', 'OPEN']);
    const [resumed] = await raw`select resolved_at from cart_abandonments where cart_id = ${cart} and status = 'RESUMED'`;
    expect(resumed.resolved_at).not.toBeNull();
  });

  it('basket reminders: one per customer, untouched and still buyable, never after an order; the claim holds the weekly cap', async () => {
    const now = new Date();
    const last = new Date(Math.floor((now.getTime() - 9 * H) / 1000) * 1000);
    const sku = `AH-${tag}`.slice(0, 20);
    hiddenProductId = (await raw`insert into products (sku, model_number, name, slug, category_id, price_ugx, active, approval_status) values (${sku}, ${sku}, 'Withdrawn', ${sku.toLowerCase()}, ${ownCategoryId}, 10000, false, 'approved') returning id`)[0].id;
    const user = async (label: string) => {
      const phone = `0772${Math.floor(100000 + Math.random() * 899999)}`;
      const [u] = await raw`insert into users (email, phone, password_hash) values (${`br-${label}-${tag}@e.com`}, ${phone}, 'x') returning id`;
      userIds.push(u.id);
      return { id: u.id as string, phone };
    };
    const basket = async (owner: string, o: { touched?: boolean; product?: string; classifiedHoursAgo?: number } = {}) => {
      const [c] = await raw`insert into carts (owner_kind, owner_id, updated_at, expires_at)
        values ('USER', ${owner}, ${o.touched ? new Date(now.getTime() - 30 * 60_000) : last}, ${new Date(now.getTime() + 100 * H)}) returning id`;
      cartIds.push(c.id);
      await raw`insert into cart_items (cart_id, product_id, quantity) values (${c.id}, ${o.product ?? productId}, 1)`;
      const [a] = await raw`insert into cart_abandonments (cart_id, owner_kind, owner_id, item_count, subtotal_ugx, status, classified_at, last_activity_at)
        values (${c.id}, 'USER', ${owner}, 1, 10000, 'OPEN', ${new Date(now.getTime() - (o.classifiedHoursAgo ?? 2) * H)}, ${last}) returning id`;
      return a.id as string;
    };
    const twoBaskets = await user('two'); const older = await basket(twoBaskets.id, { classifiedHoursAgo: 3 }); const newer = await basket(twoBaskets.id);
    const back = await user('back'); const touched = await basket(back.id, { touched: true });
    const ordered = await user('ordered'); const afterOrder = await basket(ordered.id);
    await raw`insert into orders (order_number, user_id, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method, created_at)
      values (${`BR${tag}`.slice(0, 20)}, ${ordered.id}, 'IT', ${ordered.phone}, 'Kira', 'Adr', 10000, 0, 10000, 'delivered', 'paid', 'pesapal', ${new Date(now.getTime() - 1 * H)})`;
    // Bought at the counter: staff recorded the sale under their number, spelt differently, with no account on it.
    const counter = await user('counter'); const afterCounterSale = await basket(counter.id);
    await raw`insert into orders (order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, delivery_fee, total_amount, status, payment_status, payment_method, created_at)
      values (${`BC${tag}`.slice(0, 20)}, 'IT', ${`+256 ${counter.phone.slice(1, 4)} ${counter.phone.slice(4)}`}, 'Kampala', 'Shop', 10000, 0, 10000, 'completed', 'paid', 'cash', ${new Date(now.getTime() - 1 * H)})`;
    const gone = await user('gone'); const nothingLeft = await basket(gone.id, { product: hiddenProductId });
    const capped = await user('capped'); const cappedBasket = await basket(capped.id);
    await raw`insert into cart_abandonments (cart_id, owner_kind, owner_id, item_count, subtotal_ugx, status, classified_at, last_activity_at, reminded_at, reminder_outcome)
      values (${cartIds[cartIds.length - 1]}, 'USER', ${capped.id}, 1, 10000, 'EXPIRED', now() - interval '3 days', now() - interval '3 days', now() - interval '2 days', 'sent')`;

    const mine = new Set([older, newer, touched, afterOrder, afterCounterSale, nothingLeft, cappedBasket]);
    const due = (await repo.findDue({
      classifiedBefore: new Date(now.getTime() - 1 * H), classifiedAfter: new Date(now.getTime() - 48 * H),
      noReminderSince: new Date(now.getTime() - 7 * 24 * H), limit: 500,
    })).filter((d: any) => mine.has(d.abandonmentId));
    // the newest of two baskets; the gone product counts as nothing to buy; the returned, the ordered (online or at the
    // counter) and the capped are out
    expect(due.map((d: any) => d.abandonmentId).sort()).toEqual([newer, nothingLeft].sort());
    expect(due.find((d: any) => d.abandonmentId === newer)).toMatchObject({ itemCount: 1, itemNames: ['Abandon Test'] });
    expect(due.find((d: any) => d.abandonmentId === nothingLeft)).toMatchObject({ itemCount: 0, itemNames: [] });

    // The claim: atomic per customer, re-checks the basket and the cap.
    const claim = (abandonmentId: string, userId: string) => repo.claimForReminder({ abandonmentId, userId, now, noReminderSince: new Date(now.getTime() - 7 * 24 * H) });
    expect(await claim(newer, twoBaskets.id)).toBe(true);
    expect(await claim(older, twoBaskets.id)).toBe(false); // the first is 'sending': inside the cap
    await repo.settleReminder(newer, 'sent');
    expect((await raw`select reminder_outcome from cart_abandonments where id = ${newer}`)[0].reminder_outcome).toBe('sent');
    expect(await claim(older, twoBaskets.id)).toBe(false);
    expect(await claim(touched, back.id)).toBe(false); // changed since it was classified
    expect(await claim(cappedBasket, capped.id)).toBe(false);

    // The gate's proof that a number reaches its owner: an order of theirs delivered to it.
    const { DrizzleAccountIdentityReader } = await import('../../apps/api/src/infrastructure/first-party/FirstPartyAdapters');
    const reader = new DrizzleAccountIdentityReader();
    expect(await reader.phoneReachedByOrder(ordered.id, `+256${ordered.phone.slice(1)}`)).toBe(true);
    expect(await reader.phoneReachedByOrder(twoBaskets.id, `+256${twoBaskets.phone.slice(1)}`)).toBe(false);
    expect(await reader.phoneReachedByOrder(ordered.id, '+256700000001')).toBe(false);
  });
});
