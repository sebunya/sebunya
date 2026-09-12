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

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    // The snapshot predates 0129; apply it here so this suite is honest on its own.
    await raw.unsafe(readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/db/migrations/0129_cart_abandonment_open_uq_partial.sql'), 'utf8').replace(/--> statement-breakpoint/g, ''));
    const [cat] = await raw`select id from categories limit 1`;
    const catId = cat?.id ?? (await raw`insert into categories (name, slug) values ('T', ${'t-' + Date.now()}) returning id`)[0].id;
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
    if (productId) await raw`delete from products where id = ${productId}`;
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
});
