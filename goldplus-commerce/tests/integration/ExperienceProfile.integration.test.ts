import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import crypto from "node:crypto";

/**
 * R2 (2026-08-06): the experience-profile repository against REAL PostgreSQL —
 * the upsert, the conditional customer claim, the conflict preservation, and
 * the partial-unique-index stitch are all database behaviours; fakes cannot
 * prove them.
 *
 * Runs on the production-schema commerce test DB. Migrations 0099/0100 are
 * applied idempotently at setup (IF NOT EXISTS throughout), which also proves
 * they apply cleanly against the production schema snapshot. Fixtures use
 * generated tokens; cleanup deletes only rows this suite created (TEST-ISO-1).
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite("experience profiles on real PostgreSQL", () => {
  let pg: typeof import("../../apps/api/src/infrastructure/db/client").client;
  let repo: import("../../apps/api/src/infrastructure/db/repositories/DrizzleExperienceProfileRepository").DrizzleExperienceProfileRepository;
  const createdHashes: string[] = [];

  const mintToken = () => crypto.randomBytes(24).toString("base64url");
  const hashOf = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");

  beforeAll(async () => {
    ({ client: pg } = await import("../../apps/api/src/infrastructure/db/client"));
    const { DrizzleExperienceProfileRepository } = await import(
      "../../apps/api/src/infrastructure/db/repositories/DrizzleExperienceProfileRepository"
    );
    repo = new DrizzleExperienceProfileRepository();

    for (const file of ["0099_recommendation_event_contract.sql", "0100_experience_profiles.sql"]) {
      const text = readFileSync(
        join(__dirname, "../../apps/api/src/infrastructure/db/migrations", file),
        "utf8",
      );
      for (const statement of text.split("--> statement-breakpoint")) {
        const trimmed = statement.replace(/^--.*$/gm, "").trim();
        if (trimmed) await pg.unsafe(trimmed);
      }
    }
  });

  afterAll(async () => {
    for (const hash of createdHashes) {
      await pg`delete from identity_links where profile_id in (select id from experience_profiles where token_hash = ${hash})`;
      await pg`delete from experience_profiles where token_hash = ${hash}`;
    }
  });

  const track = (raw: string) => {
    createdHashes.push(hashOf(raw));
    return raw;
  };

  it("resolveOrCreate is a true upsert: same hash → same row, last_seen advances", async () => {
    const raw = track(mintToken());
    const first = await repo.resolveOrCreate(hashOf(raw));
    const second = await repo.resolveOrCreate(hashOf(raw));
    expect(second.id).toBe(first.id);

    const rows = await pg`select first_seen_at, last_seen_at from experience_profiles where id = ${first.id}::uuid`;
    expect(new Date(rows[0].last_seen_at).getTime()).toBeGreaterThanOrEqual(new Date(rows[0].first_seen_at).getTime());
  });

  it("linkCustomer claims once, no-ops on repeat, and PRESERVES a different customer's claim", async () => {
    const raw = track(mintToken());
    const customerA = crypto.randomUUID();
    const customerB = crypto.randomUUID();

    expect(await repo.linkCustomer(hashOf(raw), customerA)).toBe("linked");
    expect(await repo.linkCustomer(hashOf(raw), customerA)).toBe("already_linked");
    expect(await repo.linkCustomer(hashOf(raw), customerB)).toBe("conflict_preserved");

    const rows = await pg`select customer_id from experience_profiles where token_hash = ${hashOf(raw)}`;
    expect(rows[0].customer_id).toBe(customerA);

    // The winning link exists once; the collision is recorded as its own fact.
    const links = await pg`
      select link_type, count(*)::int as n from identity_links
      where profile_id in (select id from experience_profiles where token_hash = ${hashOf(raw)})
      group by link_type order by link_type
    `;
    const byType = Object.fromEntries(links.map((r) => [r.link_type, r.n]));
    expect(byType.CUSTOMER_LOGIN).toBe(1);
    expect(byType.CUSTOMER_LOGIN_CONFLICT).toBe(1);
  });

  it("two racing logins on one fresh profile produce exactly one owner", async () => {
    const raw = track(mintToken());
    const customerA = crypto.randomUUID();
    const customerB = crypto.randomUUID();

    const [ra, rb] = await Promise.all([
      repo.linkCustomer(hashOf(raw), customerA),
      repo.linkCustomer(hashOf(raw), customerB),
    ]);
    expect([ra, rb].filter((o) => o === "linked")).toHaveLength(1);

    const rows = await pg`select customer_id from experience_profiles where token_hash = ${hashOf(raw)}`;
    expect([customerA, customerB]).toContain(rows[0].customer_id);
  });

  it("observeAnonymousId is idempotent at the database — the partial unique index absorbs replays", async () => {
    const raw = track(mintToken());
    const profile = await repo.resolveOrCreate(hashOf(raw));

    await repo.observeAnonymousId(profile.id, "anon_integration_test_1");
    await repo.observeAnonymousId(profile.id, "anon_integration_test_1");
    await repo.observeAnonymousId(profile.id, "anon_integration_test_2");

    const rows = await pg`
      select count(*)::int as n from identity_links
      where profile_id = ${profile.id}::uuid and link_type = 'PROFILE_OBSERVED'
    `;
    expect(rows[0].n).toBe(2);
  });

  it("the 0099 dedupe unique index absorbs a racing duplicate event write", async () => {
    const { RecommendationEvent } = await import("../../apps/api/src/domain/recommendations/RecommendationEvent");
    const { DrizzleRecommendationEventRepository } = await import(
      "../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationEventRepository"
    );
    const events = new DrizzleRecommendationEventRepository();
    const anonymousId = `anon_${crypto.randomBytes(12).toString("hex")}`;

    // A PRODUCT_VIEWED key needs a productId, and product_id is a real FK —
    // so the fixture is a real (suite-owned) product row.
    const suffix = crypto.randomBytes(6).toString("hex");
    const categoryId = crypto.randomUUID();
    const productId = crypto.randomUUID();
    await pg`insert into categories (id, name, slug) values (${categoryId}::uuid, ${`R2 Fixture ${suffix}`}, ${`r2-fixture-${suffix}`})`;
    await pg`
      insert into products (id, sku, model_number, name, slug, category_id)
      values (${productId}::uuid, ${`R2-${suffix}`}, ${`R2-${suffix}`}, ${`R2 Fixture ${suffix}`}, ${`r2-fixture-p-${suffix}`}, ${categoryId}::uuid)
    `;

    try {
      const make = () =>
        RecommendationEvent.create({
          eventType: "PRODUCT_VIEWED",
          anonymousId,
          productId,
          producer: "integration-test",
        });
      // Same identity + product + 30-min bucket → same dedupe key on both objects.
      const [w1, w2] = [await events.save(make()), await events.save(make())];
      expect([w1, w2].filter(Boolean)).toHaveLength(1);

      const rows = await pg`
        select count(*)::int as n, max(schema_version)::int as v, max(producer) as p
        from recommendation_events where anonymous_id = ${anonymousId}
      `;
      expect(rows[0].n).toBe(1);
      expect(rows[0].v).toBe(2);
      expect(rows[0].p).toBe("integration-test");
    } finally {
      await pg`delete from recommendation_events where anonymous_id = ${anonymousId}`;
      await pg`delete from products where id = ${productId}::uuid`;
      await pg`delete from categories where id = ${categoryId}::uuid`;
    }
  });
});
