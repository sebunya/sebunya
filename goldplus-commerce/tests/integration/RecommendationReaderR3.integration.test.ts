import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";

/**
 * R3 (2026-08-06): the reader's canonical-truth SQL on REAL PostgreSQL.
 * Available-to-promise, paid-only bestsellers and deterministic ordering are
 * database behaviours — a fake reader proves nothing about them.
 *
 * Fixtures are suite-owned (unique slugs/skus); cleanup deletes only what the
 * suite created (TEST-ISO-1).
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite("recommendation reader on real PostgreSQL", () => {
  let pg: typeof import("../../apps/api/src/infrastructure/db/client").client;
  let reader: import("../../apps/api/src/infrastructure/db/repositories/DrizzleProductRecommendationReader").DrizzleProductRecommendationReader;

  const suffix = crypto.randomBytes(5).toString("hex");
  const categoryId = crypto.randomUUID();
  const ids = {
    plenty: crypto.randomUUID(), // stock 10, reserved 0 → eligible
    reservedOut: crypto.randomUUID(), // stock 5, reserved 5 → ATP 0 → excluded
    zeroStock: crypto.randomUUID(), // stock 0 → excluded even though status says in_stock
    second: crypto.randomUUID(), // eligible, for ordering + bestseller rank 2
  };
  const paidOrderId = crypto.randomUUID();
  const unpaidOrderId = crypto.randomUUID();

  beforeAll(async () => {
    ({ client: pg } = await import("../../apps/api/src/infrastructure/db/client"));
    const { DrizzleProductRecommendationReader } = await import(
      "../../apps/api/src/infrastructure/db/repositories/DrizzleProductRecommendationReader"
    );
    reader = new DrizzleProductRecommendationReader();

    await pg`insert into categories (id, name, slug) values (${categoryId}::uuid, ${`R3 Cat ${suffix}`}, ${`r3-cat-${suffix}`})`;

    const mk = (id: string, name: string, slug: string, stock: number, reserved: number) => pg`
      insert into products (id, sku, model_number, name, slug, category_id, approval_status, active, stock_quantity, reserved_quantity, stock_status)
      values (${id}::uuid, ${`R3-${slug}`}, ${`R3-${slug}`}, ${name}, ${slug}, ${categoryId}::uuid, 'approved', true, ${stock}, ${reserved}, 'in_stock')
    `;
    await mk(ids.plenty, `R3 Alpha ${suffix}`, `r3-alpha-${suffix}`, 10, 0);
    await mk(ids.reservedOut, `R3 Bravo ${suffix}`, `r3-bravo-${suffix}`, 5, 5);
    await mk(ids.zeroStock, `R3 Charlie ${suffix}`, `r3-charlie-${suffix}`, 0, 0);
    await mk(ids.second, `R3 Delta ${suffix}`, `r3-delta-${suffix}`, 7, 1);

    // One PAID order (5× plenty, 2× second) and one UNPAID order (9× second):
    // the unpaid units must never inflate the ranking (RFM-1 discipline).
    const mkOrder = (id: string, paymentStatus: string, number: string) => pg`
      insert into orders (id, order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, payment_status, status)
      values (${id}::uuid, ${number}, 'R3 Fixture', '+256700000000', 'Kampala', 'R3 Fixture Address', 0, 0, ${paymentStatus}, 'received')
    `;
    await mkOrder(paidOrderId, "paid", `R3-PAID-${suffix}`);
    await mkOrder(unpaidOrderId, "unpaid", `R3-UNPAID-${suffix}`);

    const mkItem = (orderId: string, productId: string, qty: number, slug: string) => pg`
      insert into order_items (id, order_id, product_id, sku, product_name, quantity, unit_price)
      values (${crypto.randomUUID()}::uuid, ${orderId}::uuid, ${productId}::uuid, ${`R3-${slug}`}, 'R3 Fixture', ${qty}, 1000)
    `;
    await mkItem(paidOrderId, ids.plenty, 5, `r3-alpha-${suffix}`);
    await mkItem(paidOrderId, ids.second, 2, `r3-delta-${suffix}`);
    await mkItem(unpaidOrderId, ids.second, 9, `r3-delta-${suffix}`);
  });

  afterAll(async () => {
    await pg`delete from order_items where order_id in (${paidOrderId}::uuid, ${unpaidOrderId}::uuid)`;
    await pg`delete from orders where id in (${paidOrderId}::uuid, ${unpaidOrderId}::uuid)`;
    await pg`delete from products where category_id = ${categoryId}::uuid`;
    await pg`delete from categories where id = ${categoryId}::uuid`;
  });

  it("findPublicProducts enforces available-to-promise: reserved-out and zero-stock rows never surface", async () => {
    const rows = await reader.findPublicProducts({ categoryId, limit: 50 });
    const returned = rows.map((r) => r.id);
    expect(returned).toContain(ids.plenty);
    expect(returned).toContain(ids.second);
    expect(returned).not.toContain(ids.reservedOut);
    expect(returned).not.toContain(ids.zeroStock);
  });

  it("ordering is stable (name, id) — twice the same query, twice the same bytes", async () => {
    const [a, b] = await Promise.all([
      reader.findPublicProducts({ categoryId, limit: 50 }),
      reader.findPublicProducts({ categoryId, limit: 50 }),
    ]);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));
    expect(a[0].name <= a[a.length - 1].name).toBe(true);
  });

  it("bestsellers count PAID units only, ranked by units then id", async () => {
    const rows = await reader.findBestsellerProductIds({ categoryId, limit: 10 });
    expect(rows.map((r) => r.productId)).toEqual([ids.plenty, ids.second]);
    expect(rows[0].unitsSold).toBe(5);
    // 2, not 11 — the 9 unpaid units are invisible to popularity.
    expect(rows[1].unitsSold).toBe(2);
  });

  it("a 30-day window excludes nothing here (fixtures are fresh) and the query stays deterministic", async () => {
    const rows = await reader.findBestsellerProductIds({ categoryId, sinceDays: 30, limit: 10 });
    expect(rows.map((r) => r.productId)).toEqual([ids.plenty, ids.second]);
  });
});
