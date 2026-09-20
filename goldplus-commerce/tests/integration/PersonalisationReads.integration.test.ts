import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The personalisation rebuild against a REAL PostgreSQL (disposable clone,
 * scripts/integration-on-clone.sh). Covers the SQL that unit tests cannot:
 * pure profile reads, the 0144 serving counter's additive upsert, and the hero
 * signals over linked profiles with rendered-rail rows present.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('personalisation reads (real PostgreSQL)', () => {
  let raw: any;
  const hashes: string[] = [];
  const hex = (n: number) => `itest${n}${Date.now()}`.padEnd(64, '0').slice(0, 64);
  let userId: string | null = null;
  let product: { id: string; category_id: string };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 2, onnotice: () => undefined });
    product = (await raw`select id, category_id from products where category_id is not null limit 1`)[0];
    userId = (await raw`select id from users limit 1`)[0]?.id ?? null;
  });

  afterAll(async () => {
    await raw`delete from recommendation_events where profile_id in (select id from experience_profiles where token_hash = any(${hashes}))`;
    await raw`delete from experience_profiles where token_hash = any(${hashes})`;
    await raw`delete from recommendation_serving_hourly where placement like 'itest_%'`;
    await raw.end();
  });

  it('a read finds nothing and writes nothing; behaviour creates exactly one row, even concurrently', async () => {
    const { DrizzleExperienceProfileRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleExperienceProfileRepository');
    const repo = new DrizzleExperienceProfileRepository();
    const h = hex(1); hashes.push(h);
    expect(await repo.find(h)).toBeNull();
    expect((await raw`select count(*)::int n from experience_profiles where token_hash = ${h}`)[0].n).toBe(0);
    const made = await Promise.all([repo.resolveOrCreate(h), repo.resolveOrCreate(h), repo.resolveOrCreate(h)]);
    expect(new Set(made.map((m) => m.id)).size).toBe(1);
    expect((await repo.find(h))!.id).toBe(made[0].id);
  });

  it('the serving counter adds across flushes and across processes', async () => {
    const { RecommendationServingStats } = await import('../../apps/api/src/infrastructure/recommendations/RecommendationServingStats');
    const failures: unknown[] = [];
    const a = new RecommendationServingStats((e) => failures.push(e), 3_600_000);
    const b = new RecommendationServingStats((e) => failures.push(e), 3_600_000);
    const at = new Date();
    for (let i = 0; i < 5; i++) a.record({ placement: 'itest_rail', empty: i === 0, fallbackServed: i < 2, at });
    for (let i = 0; i < 3; i++) b.record({ placement: 'itest_rail', empty: false, fallbackServed: false, at });
    await Promise.all([a.flush(), b.flush()]);
    a.record({ placement: 'itest_rail', empty: false, fallbackServed: false, at });
    await a.stop(3000); await b.stop(3000);
    expect(failures).toEqual([]);
    const rows = await raw`select sum(responses)::int r, sum(empty)::int e, sum(fallback_served)::int f from recommendation_serving_hourly where placement = 'itest_rail'`;
    expect(rows[0]).toMatchObject({ r: 9, e: 1, f: 2 });
  });

  it('serving health reads the counter', async () => {
    const { DrizzleRecommendationAnalyticsRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationAnalyticsRepository');
    const health = await new DrizzleRecommendationAnalyticsRepository().getServingHealth(1);
    const row = health.placements.find((p) => p.placement === 'itest_rail');
    expect(row).toMatchObject({ responses: 9, empty: 1, fallbackServed: 2 });
  });

  it('rendered rails never count as visits; visitor actions do; a linked profile shares history; recent interest outranks old', async () => {
    const { HeroSignalsService } = await import('../../apps/api/src/infrastructure/hero/HeroSignalsService');
    const svc = new HeroSignalsService();
    const [h1, h2] = [hex(2), hex(3)]; hashes.push(h1, h2);
    const p1 = (await raw`insert into experience_profiles (token_hash) values (${h1}) returning id`)[0].id;
    // 5 days of OUR rendering, no visitor action.
    for (let d = 1; d <= 5; d++) {
      await raw`insert into recommendation_events (event_type, producer, profile_id, placement, created_at) values ('RECOMMENDATION_RESPONSE', 'api-engine', ${p1}, 'home_trending', now() - make_interval(days => ${d}))`;
      await raw`insert into recommendation_events (event_type, producer, profile_id, placement, product_id, created_at) values ('RECOMMENDATION_IMPRESSION', 'web', ${p1}, 'home_trending', ${product.id}, now() - make_interval(days => ${d}))`;
    }
    // getSignals swallows errors by design, so the queries are also called
    // directly: a broken query must FAIL here, not read as "a new visitor".
    expect(await (svc as any).visitStrength(p1)).toBe(1);
    expect(await (svc as any).categoryAffinity(p1)).toEqual([]);
    let s = await svc.getSignals(p1, []);
    expect(s.visits).toBe(1);
    expect(s.categoryAffinity).toEqual([]);

    // 3 distinct days of real product views.
    for (let d = 0; d < 3; d++) {
      await raw`insert into recommendation_events (event_type, producer, profile_id, product_id, created_at) values ('PRODUCT_VIEWED', 'web', ${p1}, ${product.id}, now() - make_interval(days => ${d}))`;
    }
    s = await svc.getSignals(p1, []);
    expect(s.visits).toBe(3);
    expect(s.categoryAffinity.length).toBe(1);
    expect(s.categoryAffinity[0].score).toBeGreaterThan(2.8);
    // Scores decay with now(), so two reads differ in the last decimals.
    const light = await svc.getCategoryAffinity(p1);
    expect(light.map((a) => a.categorySlug)).toEqual(s.categoryAffinity.map((a) => a.categorySlug));
    expect(light[0].score).toBeCloseTo(s.categoryAffinity[0].score, 3);
    expect(await svc.getCategoryAffinity(null)).toEqual([]);

    // The same views a year ago fade to almost nothing.
    await raw`update recommendation_events set created_at = created_at - interval '365 days' where profile_id = ${p1} and event_type = 'PRODUCT_VIEWED'`;
    s = await svc.getSignals(p1, []);
    expect(s.categoryAffinity.length === 0 || s.categoryAffinity[0].score < 0.3).toBe(true);
    expect(s.visits).toBeGreaterThanOrEqual(3); // lifetime relationship is kept

    if (userId) {
      // A new phone, same signed-in customer: history follows.
      await raw`update experience_profiles set customer_id = ${userId} where id = ${p1}`;
      const p2 = (await raw`insert into experience_profiles (token_hash, customer_id) values (${h2}, ${userId}) returning id`)[0].id;
      const s2 = await svc.getSignals(p2, []);
      expect(s2.visits).toBeGreaterThanOrEqual(3);
    }
  }, 30_000);
});
