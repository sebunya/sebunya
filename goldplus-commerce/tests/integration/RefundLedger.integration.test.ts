import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";

/**
 * The refund ledger (0103) against REAL PostgreSQL.
 *
 * The unit tests prove the arithmetic. Only a real database can prove the part
 * that actually protects the money: that two refunds racing for the same
 * headroom cannot both win. The in-memory fake is single-threaded and would
 * pass a broken implementation, so the concurrency claim is made here or not
 * at all.
 *
 * Fixtures are suite-owned; cleanup deletes only what the suite created.
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite("refund ledger on real PostgreSQL", () => {
  let pg: typeof import("../../apps/api/src/infrastructure/db/client").client;
  let repo: import("../../apps/api/src/infrastructure/db/repositories/DrizzleRefundLedgerRepository").DrizzleRefundLedgerRepository;

  const suffix = crypto.randomBytes(5).toString("hex");
  const categoryId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const itemAId = crypto.randomUUID();
  const itemBId = crypto.randomUUID();
  const COLLECTED = 100_000;

  beforeAll(async () => {
    ({ client: pg } = await import("../../apps/api/src/infrastructure/db/client"));
    const { DrizzleRefundLedgerRepository } = await import(
      "../../apps/api/src/infrastructure/db/repositories/DrizzleRefundLedgerRepository"
    );
    repo = new DrizzleRefundLedgerRepository();

    const { applyRecommendationMigrations } = await import("./helpers/applyRecommendationMigrations");
    await applyRecommendationMigrations(pg);

    await pg`insert into categories (id, name, slug) values (${categoryId}::uuid, ${`RL ${suffix}`}, ${`rl-${suffix}`})`;
    await pg`
      insert into products (id, sku, model_number, name, slug, category_id, approval_status, active, stock_quantity, stock_status)
      values (${productId}::uuid, ${`RL-${suffix}`}, ${`RL-${suffix}`}, ${`RL ${suffix}`}, ${`rl-p-${suffix}`}, ${categoryId}::uuid, 'approved', true, 10, 'in_stock')
    `;
    await pg`
      insert into orders (id, order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, payment_status, status)
      values (${orderId}::uuid, ${`RL-${suffix}`}, 'RL Fixture', '+256700000002', 'Kampala', 'RL Address', 0, ${COLLECTED}, 'paid', 'received')
    `;
    await pg`
      insert into payment_attempts (id, order_id, merchant_reference, amount, currency, status)
      values (${attemptId}::uuid, ${orderId}::uuid, ${`RL-REF-${suffix}`}, ${COLLECTED}, 'UGX', 'completed')
    `;
    const mkItem = (id: string, net: number) => pg`
      insert into order_items (id, order_id, product_id, sku, product_name, quantity, unit_price, base_subtotal, discount_amount, final_line_total)
      values (${id}::uuid, ${orderId}::uuid, ${productId}::uuid, ${`RL-${suffix}`}, 'RL Line', 1, ${net}, ${net}, 0, ${net})
    `;
    await mkItem(itemAId, 60_000);
    await mkItem(itemBId, 40_000);
  });

  afterAll(async () => {
    await pg`delete from payment_refund_lines where refund_id in (select id from payment_refunds where order_id = ${orderId}::uuid)`;
    await pg`delete from payment_refunds where order_id = ${orderId}::uuid`;
    await pg`delete from payment_attempts where order_id = ${orderId}::uuid`;
    await pg`delete from order_items where order_id = ${orderId}::uuid`;
    await pg`delete from orders where id = ${orderId}::uuid`;
    await pg`delete from products where category_id = ${categoryId}::uuid`;
    await pg`delete from categories where id = ${categoryId}::uuid`;
  });

  const reserve = (amountUgx: number, key: string, lines: Array<{ orderItemId: string; amountUgx: number }> = []) =>
    repo.reserveRefund({
      paymentAttemptId: attemptId,
      orderId,
      collectedUgx: COLLECTED,
      idempotencyKey: `${key}-${suffix}`,
      amountUgx,
      reason: "integration proof of the refundable balance",
      requestedBy: crypto.randomUUID(),
      lines,
    });

  it("CONCURRENCY: two simultaneous refunds cannot both take the same headroom", async () => {
    // 60k + 60k = 120k against 100k collected. Exactly one must win.
    const [a, b] = await Promise.all([reserve(60_000, "race-a"), reserve(60_000, "race-b")]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["EXCEEDS_REFUNDABLE_BALANCE", "RESERVED"]);
    expect(await repo.getRefundedTotalUgx(attemptId)).toBe(60_000);
  });

  it("the remaining balance is exactly what is left, and one shilling more is refused", async () => {
    expect((await reserve(40_001, "over")).outcome).toBe("EXCEEDS_REFUNDABLE_BALANCE");
    expect((await reserve(40_000, "exact")).outcome).toBe("RESERVED");
    expect(await repo.getRefundedTotalUgx(attemptId)).toBe(COLLECTED);
    // Fully refunded now: nothing further, not even 1 UGX.
    expect((await reserve(1, "after-full")).outcome).toBe("EXCEEDS_REFUNDABLE_BALANCE");
  });

  it("IDEMPOTENCY: the same key returns the original row and reserves nothing new", async () => {
    const before = await repo.getRefundedTotalUgx(attemptId);
    const replay = await reserve(60_000, "race-a");
    expect(replay.outcome).toBe("ALREADY_PROCESSED");
    expect(await repo.getRefundedTotalUgx(attemptId)).toBe(before);
  });

  it("a rejected refund releases its balance again", async () => {
    const rows = await pg`select id from payment_refunds where order_id = ${orderId}::uuid order by created_at limit 1`;
    await repo.recordProviderOutcome(String(rows[0].id), { status: "rejected", providerStatus: "REJECTED" });
    expect(await repo.getRefundedTotalUgx(attemptId)).toBe(40_000);
    expect((await reserve(60_000, "reclaimed")).outcome).toBe("RESERVED");
  });

  it("line allocations must belong to the order and fit the line's own remaining value", async () => {
    // Fresh attempt so this test owns its balance.
    const freshAttempt = crypto.randomUUID();
    await pg`
      insert into payment_attempts (id, order_id, merchant_reference, amount, currency, status)
      values (${freshAttempt}::uuid, ${orderId}::uuid, ${`RL-REF2-${suffix}`}, ${COLLECTED}, 'UGX', 'completed')
    `;
    const reserveOn = (amountUgx: number, key: string, lines: Array<{ orderItemId: string; amountUgx: number }>) =>
      repo.reserveRefund({
        paymentAttemptId: freshAttempt,
        orderId,
        collectedUgx: COLLECTED,
        idempotencyKey: `${key}-${suffix}`,
        amountUgx,
        reason: "integration proof of line allocation",
        requestedBy: crypto.randomUUID(),
        lines,
      });

    // A line from another order does not exist here.
    const alien = await reserveOn(1_000, "alien", [{ orderItemId: crypto.randomUUID(), amountUgx: 1_000 }]);
    expect(alien.outcome).toBe("INVALID_LINE_ALLOCATION");

    // Line A is worth 60,000 — 70,000 cannot come off it.
    const tooMuch = await reserveOn(70_000, "line-over", [{ orderItemId: itemAId, amountUgx: 70_000 }]);
    expect(tooMuch.outcome).toBe("INVALID_LINE_ALLOCATION");

    // Allocations must sum to the refund.
    const mismatch = await reserveOn(50_000, "mismatch", [{ orderItemId: itemAId, amountUgx: 20_000 }]);
    expect(mismatch.outcome).toBe("INVALID_LINE_ALLOCATION");

    // A valid split across both lines.
    const ok = await reserveOn(50_000, "split", [
      { orderItemId: itemAId, amountUgx: 30_000 },
      { orderItemId: itemBId, amountUgx: 20_000 },
    ]);
    expect(ok.outcome).toBe("RESERVED");

    // And the same line cannot be drained twice.
    const drainAgain = await reserveOn(40_000, "drain", [{ orderItemId: itemAId, amountUgx: 40_000 }]);
    expect(drainAgain.outcome).toBe("INVALID_LINE_ALLOCATION");

    await pg`delete from payment_refund_lines where refund_id in (select id from payment_refunds where payment_attempt_id = ${freshAttempt}::uuid)`;
    await pg`delete from payment_refunds where payment_attempt_id = ${freshAttempt}::uuid`;
    await pg`delete from payment_attempts where id = ${freshAttempt}::uuid`;
  });
});
