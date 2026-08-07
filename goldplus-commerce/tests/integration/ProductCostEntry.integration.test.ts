import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";

/**
 * Product cost entry (0104) against REAL PostgreSQL.
 *
 * This is the feature whose absence made "enter costs to activate profit" a
 * lie: `product_prices.cost_price` had no writer anywhere. The properties
 * proven here are the ones margin depends on being true.
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite("product cost entry on real PostgreSQL", () => {
  let pg: typeof import("../../apps/api/src/infrastructure/db/client").client;
  let repo: import("../../apps/api/src/infrastructure/db/repositories/DrizzleProductCostRepository").DrizzleProductCostRepository;

  const suffix = crypto.randomBytes(5).toString("hex");
  const categoryId = crypto.randomUUID();
  const productA = crypto.randomUUID();
  const productB = crypto.randomUUID();
  const skuA = `PC-A-${suffix}`;
  const skuB = `PC-B-${suffix}`;
  const operator = crypto.randomUUID();

  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    ({ client: pg } = await import("../../apps/api/src/infrastructure/db/client"));
    const { DrizzleProductCostRepository } = await import(
      "../../apps/api/src/infrastructure/db/repositories/DrizzleProductCostRepository"
    );
    repo = new DrizzleProductCostRepository();

    const { applyRecommendationMigrations } = await import("./helpers/applyRecommendationMigrations");
    await applyRecommendationMigrations(pg);

    await pg`insert into categories (id, name, slug) values (${categoryId}::uuid, ${`PC ${suffix}`}, ${`pc-${suffix}`})`;
    const mkProduct = (id: string, sku: string, slug: string) => pg`
      insert into products (id, sku, model_number, name, slug, category_id, approval_status, active, stock_quantity, stock_status)
      values (${id}::uuid, ${sku}, ${sku}, ${`PC ${sku}`}, ${slug}, ${categoryId}::uuid, 'approved', true, 5, 'in_stock')
    `;
    await mkProduct(productA, skuA, `pc-a-${suffix}`);
    await mkProduct(productB, skuB, `pc-b-${suffix}`);
    await pg`insert into product_prices (product_id, retail_price) values (${productA}::uuid, 100000), (${productB}::uuid, 50000)`;
  });

  afterAll(async () => {
    await pg`delete from product_cost_entries where product_id in (${productA}::uuid, ${productB}::uuid)`;
    await pg`delete from product_prices where product_id in (${productA}::uuid, ${productB}::uuid)`;
    await pg`delete from products where category_id = ${categoryId}::uuid`;
    await pg`delete from categories where id = ${categoryId}::uuid`;
  });

  const importRows = (rows: any[], dryRun = false) =>
    repo.importCosts({ rows, source: `test-${suffix}`, enteredBy: operator, dryRun });

  it("a DRY RUN validates and plans but writes absolutely nothing", async () => {
    const result = await importRows([{ identifier: skuA, costPriceUgx: 40_000, effectiveFrom: today }], true);
    expect(result.accepted).toBe(true);
    expect(result.applied).toBe(0);
    expect(result.plan[0]).toMatchObject({ sku: skuA, costPriceUgx: 40_000, previousCostUgx: null });

    const [row] = await pg`select cost_price from product_prices where product_id = ${productA}::uuid`;
    expect(row.cost_price).toBeNull();
    const [count] = await pg`select count(*)::int as n from product_cost_entries where product_id = ${productA}::uuid`;
    expect(count.n).toBe(0);
  });

  it("ONE bad row rejects the WHOLE file — no partial commit", async () => {
    const result = await importRows([
      { identifier: skuA, costPriceUgx: 40_000, effectiveFrom: today },
      { identifier: "NO-SUCH-SKU", costPriceUgx: 10_000, effectiveFrom: today },
      { identifier: skuB, costPriceUgx: -5, effectiveFrom: today },
      { identifier: skuB, costPriceUgx: 1_000, effectiveFrom: "2026-99-99" },
    ]);

    expect(result.accepted).toBe(false);
    expect(result.applied).toBe(0);
    // Errors are reported BY ROW NUMBER, which is what the operator is looking at.
    expect(result.errors.map((e) => e.rowNumber).sort()).toEqual([2, 3, 4]);
    expect(result.errors.find((e) => e.rowNumber === 2)!.message).toMatch(/No product matches/);
    expect(result.errors.find((e) => e.rowNumber === 4)!.message).toMatch(/real YYYY-MM-DD/);

    // The valid row 1 must NOT have landed.
    const [count] = await pg`select count(*)::int as n from product_cost_entries where product_id = ${productA}::uuid`;
    expect(count.n).toBe(0);
  });

  it("a non-UGX row is refused rather than silently treated as shillings", async () => {
    const result = await importRows([{ identifier: skuA, costPriceUgx: 40_000, effectiveFrom: today, currency: "USD" }]);
    expect(result.accepted).toBe(false);
    expect(result.errors[0].message).toMatch(/Only UGX/);
  });

  it("a file that states two costs for the same product and date contradicts itself", async () => {
    const result = await importRows([
      { identifier: skuA, costPriceUgx: 40_000, effectiveFrom: today },
      { identifier: skuA, costPriceUgx: 41_000, effectiveFrom: today },
    ]);
    expect(result.accepted).toBe(false);
    expect(result.errors[0].message).toMatch(/already sets a cost/);
  });

  it("a clean file commits and materialises the CURRENT cost onto product_prices", async () => {
    const result = await importRows([
      { identifier: skuA, costPriceUgx: 40_000, effectiveFrom: today },
      { identifier: skuB, costPriceUgx: 20_000, effectiveFrom: today },
    ]);
    expect(result.accepted).toBe(true);
    expect(result.applied).toBe(2);

    const rows = await pg`select product_id, cost_price from product_prices where product_id in (${productA}::uuid, ${productB}::uuid) order by cost_price`;
    expect(rows.map((r: any) => Number(r.cost_price))).toEqual([20_000, 40_000]);
  });

  it("a FUTURE-dated cost is stored but does not become current until its day arrives", async () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const result = await importRows([{ identifier: skuA, costPriceUgx: 99_000, effectiveFrom: future }]);
    expect(result.accepted).toBe(true);

    const [price] = await pg`select cost_price from product_prices where product_id = ${productA}::uuid`;
    expect(Number(price.cost_price)).toBe(40_000); // still today's cost, not the future one

    const entries = await repo.listEntriesForProduct(productA);
    expect(entries.some((e) => e.costPriceUgx === 99_000 && e.effectiveFrom === future)).toBe(true);
  });

  it("a CORRECTION supersedes the old entry and keeps BOTH numbers in the trail", async () => {
    const result = await importRows([{ identifier: skuA, costPriceUgx: 44_000, effectiveFrom: today }]);
    expect(result.accepted).toBe(true);
    expect(result.plan[0].isCorrection).toBe(true);
    expect(result.plan[0].previousCostUgx).toBe(40_000);

    const entries = await repo.listEntriesForProduct(productA);
    const forToday = entries.filter((e) => e.effectiveFrom === today);
    // The wrong number is retained, stamped superseded; the right one is live.
    expect(forToday.filter((e) => e.supersededAt !== null).map((e) => e.costPriceUgx)).toEqual([40_000]);
    const live = forToday.filter((e) => e.supersededAt === null);
    expect(live).toHaveLength(1);
    expect(live[0].costPriceUgx).toBe(44_000);
    expect(live[0].correctsEntryId).not.toBeNull();

    const [price] = await pg`select cost_price from product_prices where product_id = ${productA}::uuid`;
    expect(Number(price.cost_price)).toBe(44_000);
  });

  it("A COST CHANGE NEVER REWRITES AN ORDER ALREADY SOLD", async () => {
    // Sell at the cost in force now, then change the cost.
    const orderId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    await pg`
      insert into orders (id, order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, payment_status, status)
      values (${orderId}::uuid, ${`PC-ORD-${suffix}`}, 'PC Fixture', '+256700000003', 'Kampala', 'PC Address', 0, 100000, 'paid', 'received')
    `;
    const [priceNow] = await pg`select cost_price from product_prices where product_id = ${productA}::uuid`;
    await pg`
      insert into order_items (id, order_id, product_id, sku, product_name, quantity, unit_price, base_subtotal, discount_amount, final_line_total, cogs_snapshot_ugx)
      values (${itemId}::uuid, ${orderId}::uuid, ${productA}::uuid, ${skuA}, 'PC Line', 1, 100000, 100000, 0, 100000, ${priceNow.cost_price})
    `;

    await importRows([{ identifier: skuA, costPriceUgx: 77_000, effectiveFrom: today }]);

    const [item] = await pg`select cogs_snapshot_ugx from order_items where id = ${itemId}::uuid`;
    expect(Number(item.cogs_snapshot_ugx)).toBe(44_000); // the cost at SALE, not the new one
    const [price] = await pg`select cost_price from product_prices where product_id = ${productA}::uuid`;
    expect(Number(price.cost_price)).toBe(77_000);

    await pg`delete from order_items where id = ${itemId}::uuid`;
    await pg`delete from orders where id = ${orderId}::uuid`;
  });

  it("coverage reports the gap, and products without a cost come first", async () => {
    // Strip B's cost so there is a genuine gap to see.
    await pg`update product_prices set cost_price = null where product_id = ${productB}::uuid`;
    const coverage = await repo.getCoverage(500);
    expect(coverage.totalActiveProducts).toBeGreaterThanOrEqual(2);
    expect(coverage.withCost + coverage.withoutCost).toBe(coverage.totalActiveProducts);

    const mine = coverage.rows.filter((r) => r.sku === skuA || r.sku === skuB);
    expect(mine.find((r) => r.sku === skuB)!.currentCostUgx).toBeNull();
    expect(mine.find((r) => r.sku === skuA)!.currentCostUgx).toBe(77_000);

    const firstUncosted = coverage.rows.findIndex((r) => r.currentCostUgx === null);
    const firstCosted = coverage.rows.findIndex((r) => r.currentCostUgx !== null);
    if (firstUncosted !== -1 && firstCosted !== -1) expect(firstUncosted).toBeLessThan(firstCosted);
  });
});
