import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";

/**
 * getTrendingEvents against REAL PostgreSQL.
 *
 * This exists because the trending rung was dead in production and nothing
 * noticed. The aggregate groups on `coalesce(recommendation_product_id,
 * product_id)` but ordered by the bare `product_id` column, which is not in the
 * GROUP BY — Postgres rejects that outright, so every call threw, the engine
 * logged RECOMMENDATION_ENGINE_DEGRADED and fell down the ladder to
 * NEW_ARRIVAL. Every existing test for this method mocked the repository, so
 * the SQL was never executed by the suite at all.
 *
 * The lesson encoded here: a query that is only ever mocked is a query nobody
 * has run.
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite("trending aggregate on real PostgreSQL", () => {
  let pg: typeof import("../../apps/api/src/infrastructure/db/client").client;
  let repo: import("../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationEventRepository").DrizzleRecommendationEventRepository;

  const suffix = crypto.randomBytes(5).toString("hex");
  const categoryId = crypto.randomUUID();
  const viewedProduct = crypto.randomUUID();
  const clickedProduct = crypto.randomUUID();
  const anonId = `anon_${crypto.randomBytes(10).toString("hex")}`;

  beforeAll(async () => {
    ({ client: pg } = await import("../../apps/api/src/infrastructure/db/client"));
    const { DrizzleRecommendationEventRepository } = await import(
      "../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationEventRepository"
    );
    repo = new DrizzleRecommendationEventRepository();

    const { applyRecommendationMigrations } = await import("./helpers/applyRecommendationMigrations");
    await applyRecommendationMigrations(pg);

    await pg`insert into categories (id, name, slug) values (${categoryId}::uuid, ${`TR ${suffix}`}, ${`tr-${suffix}`})`;
    const mkProduct = (id: string, slug: string) => pg`
      insert into products (id, sku, model_number, name, slug, category_id, approval_status, active, stock_quantity, stock_status)
      values (${id}::uuid, ${`TR-${slug}`}, ${`TR-${slug}`}, ${`TR ${slug}`}, ${slug}, ${categoryId}::uuid, 'approved', true, 5, 'in_stock')
    `;
    await mkProduct(viewedProduct, `tr-view-${suffix}`);
    await mkProduct(clickedProduct, `tr-click-${suffix}`);

    // A browse event carries product_id. Two of them.
    for (let i = 0; i < 2; i += 1) {
      await pg`
        insert into recommendation_events (id, event_type, anonymous_id, product_id, producer, schema_version)
        values (${crypto.randomUUID()}::uuid, 'PRODUCT_VIEWED', ${anonId}, ${viewedProduct}::uuid, 'integration-test', 2)
      `;
    }
    // A recommendation click carries recommendation_product_id with a NULL
    // product_id — the exact shape the coalesce exists to rescue.
    await pg`
      insert into recommendation_events (id, event_type, anonymous_id, recommendation_product_id, placement, producer, schema_version)
      values (${crypto.randomUUID()}::uuid, 'RECOMMENDATION_CLICKED', ${anonId}, ${clickedProduct}::uuid, 'home_trending', 'integration-test', 2)
    `;
  });

  afterAll(async () => {
    await pg`delete from recommendation_events where anonymous_id = ${anonId}`;
    await pg`delete from products where category_id = ${categoryId}::uuid`;
    await pg`delete from categories where id = ${categoryId}::uuid`;
  });

  it("EXECUTES — the aggregate must not throw, which is how the trending rung died", async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const rows = await repo.getTrendingEvents({ since, limit: 500 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("counts browse events on product_id AND recommendation engagement on recommendation_product_id", async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const rows = await repo.getTrendingEvents({ since, limit: 500 });

    const viewed = rows.find((r) => r.productId === viewedProduct && r.eventType === "PRODUCT_VIEWED");
    expect(viewed?.count).toBe(2);

    // The row that a bare product_id grouping would have silently dropped.
    const clicked = rows.find((r) => r.productId === clickedProduct && r.eventType === "RECOMMENDATION_CLICKED");
    expect(clicked?.count).toBe(1);
  });

  it("orders deterministically, so the LIMIT cannot truncate arbitrarily", async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const a = await repo.getTrendingEvents({ since, limit: 500 });
    const b = await repo.getTrendingEvents({ since, limit: 500 });
    expect(a.map((r) => `${r.productId}:${r.eventType}`)).toEqual(b.map((r) => `${r.productId}:${r.eventType}`));
  });
});
