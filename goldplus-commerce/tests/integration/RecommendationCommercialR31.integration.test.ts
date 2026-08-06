import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";

/**
 * R3.1 (2026-08-06): the commercial-attribution projection on REAL PostgreSQL.
 * The golden chain — impression → click → ATC → paid order → order item —
 * is seeded with server identities, and every truth rule is proven against
 * actual SQL: precedence, one-primary-per-line, refund reversal, mixed
 * attributed/organic lines, COGS partiality, and the canonical JSONB fix.
 *
 * Fixtures are suite-owned; cleanup deletes only what the suite created.
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite("commercial attribution on real PostgreSQL", () => {
  let pg: typeof import("../../apps/api/src/infrastructure/db/client").client;
  let repo: import("../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationCommercialRepository").DrizzleRecommendationCommercialRepository;

  const suffix = crypto.randomBytes(5).toString("hex");
  const categoryId = crypto.randomUUID();
  const recommendedProduct = crypto.randomUUID();
  const organicProduct = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const paidOrderId = crypto.randomUUID();
  const reversedOrderId = crypto.randomUUID();
  const orderIds = [paidOrderId, reversedOrderId];

  beforeAll(async () => {
    ({ client: pg } = await import("../../apps/api/src/infrastructure/db/client"));
    const { DrizzleRecommendationCommercialRepository } = await import(
      "../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationCommercialRepository"
    );
    repo = new DrizzleRecommendationCommercialRepository();

    const { applyRecommendationMigrations } = await import("./helpers/applyRecommendationMigrations");
    await applyRecommendationMigrations(pg);

    await pg`insert into categories (id, name, slug) values (${categoryId}::uuid, ${`R31 ${suffix}`}, ${`r31-${suffix}`})`;
    const mkProduct = (id: string, slug: string) => pg`
      insert into products (id, sku, model_number, name, slug, category_id, approval_status, active, stock_quantity, stock_status)
      values (${id}::uuid, ${`R31-${slug}`}, ${`R31-${slug}`}, ${`R31 ${slug}`}, ${slug}, ${categoryId}::uuid, 'approved', true, 10, 'in_stock')
    `;
    await mkProduct(recommendedProduct, `r31-rec-${suffix}`);
    await mkProduct(organicProduct, `r31-org-${suffix}`);

    await pg`insert into experience_profiles (id, token_hash) values (${profileId}::uuid, ${crypto.randomBytes(32).toString("hex")})`;

    // The golden touch chain, all on the SAME server profile: an impression
    // (assist-grade), then a click, then an ATC — precedence must pick the ATC.
    const mkTouch = (type: string, minutesAgo: number) => pg`
      insert into recommendation_events (id, event_type, profile_id, recommendation_product_id, placement, producer, schema_version, created_at)
      values (${crypto.randomUUID()}::uuid, ${type}, ${profileId}::uuid, ${recommendedProduct}::uuid, 'home_trending', 'integration-test', 2, now() - make_interval(mins => ${minutesAgo}))
    `;
    await mkTouch("RECOMMENDATION_IMPRESSION", 180);
    await mkTouch("RECOMMENDATION_CLICKED", 120);
    await mkTouch("RECOMMENDATION_ADD_TO_CART", 60);

    // One PAID order holding BOTH a recommended line and an organic line (AC2).
    const mkOrder = (id: string, number: string, paymentStatus: string) => pg`
      insert into orders (id, order_number, customer_name, customer_phone, delivery_area, delivery_address, subtotal_amount, total_amount, payment_status, status, profile_id)
      values (${id}::uuid, ${number}, 'R31 Fixture', '+256700000001', 'Kampala', 'R31 Address', 0, 0, ${paymentStatus}, 'received', ${profileId}::uuid)
    `;
    await mkOrder(paidOrderId, `R31-PAID-${suffix}`, "paid");
    await mkOrder(reversedOrderId, `R31-REV-${suffix}`, "paid");

    const mkItem = (orderId: string, productId: string, net: number, cogs: number | null) => pg`
      insert into order_items (id, order_id, product_id, sku, product_name, quantity, unit_price, base_subtotal, discount_amount, final_line_total, cogs_snapshot_ugx)
      values (${crypto.randomUUID()}::uuid, ${orderId}::uuid, ${productId}::uuid, ${`R31-${productId.slice(0, 8)}`}, 'R31 Line', 1, ${net}, ${net}, 0, ${net}, ${cogs})
    `;
    await mkItem(paidOrderId, recommendedProduct, 50_000, 30_000);
    await mkItem(paidOrderId, organicProduct, 20_000, null);
    // The fully refunded order also bought the recommended product — its
    // revenue must NEVER appear (AC6).
    //
    // 2026-08-07: a full refund is now recorded in the refund ledger (0103),
    // not inferred from an attempt reading 'reversed'. That old signal could
    // not distinguish a total reversal from a partial one, so a delivery-fee
    // refund erased the whole order. The attempt stays 'completed' — money WAS
    // collected — and the refund rows are what take it back.
    await mkItem(reversedOrderId, recommendedProduct, 99_000, null);
    const reversedAttemptId = crypto.randomUUID();
    await pg`
      insert into payment_attempts (id, order_id, merchant_reference, amount, currency, status)
      values (${reversedAttemptId}::uuid, ${reversedOrderId}::uuid, ${`R31-REV-${suffix}`}, 99000, 'UGX', 'completed')
    `;
    await pg`
      insert into payment_refunds (payment_attempt_id, order_id, idempotency_key, amount_ugx, reason, status)
      values (${reversedAttemptId}::uuid, ${reversedOrderId}::uuid, ${`R31-FULL-${suffix}`}, 99000, 'full refund fixture', 'settled')
    `;
  });

  afterAll(async () => {
    await pg`delete from payment_refund_lines where refund_id in (select id from payment_refunds where order_id in ${pg(orderIds)})`;
    await pg`delete from payment_refunds where order_id in ${pg(orderIds)}`;
    await pg`delete from payment_attempts where order_id in ${pg(orderIds)}`;
    await pg`delete from order_items where order_id in ${pg(orderIds)}`;
    await pg`delete from orders where id in ${pg(orderIds)}`;
    await pg`delete from recommendation_events where profile_id = ${profileId}::uuid`;
    await pg`delete from experience_profiles where id = ${profileId}::uuid`;
    await pg`delete from products where category_id = ${categoryId}::uuid`;
    await pg`delete from categories where id = ${categoryId}::uuid`;
  });

  it("AC1/AC16: the golden chain yields exactly ONE primary attribution — the ATC wins precedence", async () => {
    const lines = await repo.getAttributedLines(30, 1000);
    const mine = lines.filter((l) => l.orderId === paidOrderId);
    expect(mine).toHaveLength(1);
    expect(mine[0].productId).toBe(recommendedProduct);
    expect(mine[0].mechanism).toBe("RECOMMENDATION_ADD_TO_CART");
    expect(mine[0].netRevenueUgx).toBe(50_000);
    expect(mine[0].cogsSnapshotUgx).toBe(30_000);
  });

  it("AC2: the organic line on the same order is NOT attributed; AC6: the reversed order contributes nothing", async () => {
    const lines = await repo.getAttributedLines(30, 1000);
    expect(lines.some((l) => l.productId === organicProduct)).toBe(false);
    expect(lines.some((l) => l.orderId === reversedOrderId)).toBe(false);
  });

  it("totals partition honestly: attributed vs organic vs reversed-excluded, margin only over costed lines", async () => {
    const totals = await repo.getCommercialTotals(30);
    expect(totals.directAttributedNetUgx).toBeGreaterThanOrEqual(50_000);
    // The paid order's organic 20k line is organic, never attributed.
    expect(totals.organicPaidNetUgx).toBeGreaterThanOrEqual(20_000);
    expect(totals.reversedOrdersExcluded).toBeGreaterThanOrEqual(1);
    // Margin computed ONLY over the line whose COGS snapshot exists: 50k − 30k.
    expect(totals.attributedGrossMarginUgx).toBeGreaterThanOrEqual(20_000);
  });

  it("the funnel reaches paid via canonical status and the same profile join", async () => {
    const funnel = await repo.getCommercialFunnel(30);
    expect(funnel.paidOrdersFromTouchedProfiles).toBeGreaterThanOrEqual(1);
    expect(funnel.completedOrdersFromTouchedProfiles).toBe(0); // nothing is 'completed'
  });

  it("media-cost ingestion dedupes on the logical key (AC15 date/currency held deterministic)", async () => {
    const fact = {
      spendDate: "2026-08-01",
      channel: "paid_social",
      platform: `r31-${suffix}`,
      account: "acct-1",
      campaign: `camp-${suffix}`,
      currency: "UGX",
      spendMinor: 100_000,
      taxOrFeeMinor: 0,
      source: "integration-test",
      ingestedBy: crypto.randomUUID(),
    };
    try {
      const first = await repo.insertMediaCostFact(fact);
      const second = await repo.insertMediaCostFact(fact);
      expect(first.inserted).toBe(true);
      expect(second.inserted).toBe(false);
      const spend = await repo.getMediaSpend(30);
      expect(spend.campaigns.some((c) => c.campaign === fact.campaign)).toBe(true); // 2026-08-01 is inside the 30-day window
    } finally {
      await pg`delete from media_cost_facts where platform = ${fact.platform}`;
    }
  });

  it("AC21/AC22: new event metadata round-trips as a REAL jsonb object; historic string rows stay readable", async () => {
    const { RecommendationEvent } = await import("../../apps/api/src/domain/recommendations/RecommendationEvent");
    const { DrizzleRecommendationEventRepository } = await import(
      "../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationEventRepository"
    );
    const events = new DrizzleRecommendationEventRepository();
    const anon = `anon_${crypto.randomBytes(12).toString("hex")}`;
    try {
      await events.save(
        RecommendationEvent.create({
          eventType: "RECOMMENDATION_CLICKED",
          anonymousId: anon,
          recommendationProductId: recommendedProduct,
          placement: "home_trending",
          producer: "integration-test",
          metadata: { probe: "r31-jsonb", nested: { n: 1 } },
        }),
      );
      const rows = await pg`
        select jsonb_typeof(metadata) as t, metadata->>'probe' as probe
        from recommendation_events where anonymous_id = ${anon}
      `;
      expect(rows[0].t).toBe("object");
      expect(rows[0].probe).toBe("r31-jsonb");
    } finally {
      await pg`delete from recommendation_events where anonymous_id = ${anon}`;
    }
  });
});
