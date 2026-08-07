import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';

/**
 * Hero personalisation signals + telemetry (Task 3) on REAL PostgreSQL.
 *
 * The signals are ENHANCEMENTS derived from the server profile and the
 * catalogue; the properties worth proving are that they reflect real behaviour,
 * degrade to empty on a missing profile, and never expose PII.
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('hero signals + telemetry on real PostgreSQL', () => {
  let pg: typeof import('../../apps/api/src/infrastructure/db/client').client;
  let signals: import('../../apps/api/src/infrastructure/hero/HeroSignalsService').HeroSignalsService;
  let telemetry: import('../../apps/api/src/infrastructure/hero/HeroTelemetryService').HeroTelemetryService;

  const suffix = crypto.randomBytes(5).toString('hex');
  const categoryId = crypto.randomUUID();
  const inStock = crypto.randomUUID();
  const outStock = crypto.randomUUID();
  const inStockSlug = `hs-in-${suffix}`;
  const outStockSlug = `hs-out-${suffix}`;
  const profileId = crypto.randomUUID();

  beforeAll(async () => {
    ({ client: pg } = await import('../../apps/api/src/infrastructure/db/client'));
    const { HeroSignalsService } = await import('../../apps/api/src/infrastructure/hero/HeroSignalsService');
    const { HeroTelemetryService } = await import('../../apps/api/src/infrastructure/hero/HeroTelemetryService');
    signals = new HeroSignalsService();
    telemetry = new HeroTelemetryService();
    const { applyRecommendationMigrations } = await import('./helpers/applyRecommendationMigrations');
    await applyRecommendationMigrations(pg);

    await pg`insert into categories (id, name, slug) values (${categoryId}::uuid, ${`HS ${suffix}`}, ${`hs-${suffix}`})`;
    const mk = (id: string, slug: string, stock: string, qty: number) => pg`
      insert into products (id, sku, model_number, name, slug, category_id, approval_status, active, stock_quantity, stock_status, image_url)
      values (${id}::uuid, ${slug}, ${slug}, ${`HS ${slug}`}, ${slug}, ${categoryId}::uuid, 'approved', true, ${qty}, ${stock}, ${`/products/${slug}.webp`})
    `;
    await mk(inStock, inStockSlug, 'in_stock', 10);
    await mk(outStock, outStockSlug, 'out_of_stock', 0);

    await pg`insert into experience_profiles (id, token_hash) values (${profileId}::uuid, ${crypto.randomBytes(32).toString('hex')})`;
    // The profile browses the in-stock product's category three times.
    for (let i = 0; i < 3; i += 1) {
      await pg`insert into recommendation_events (id, event_type, profile_id, recommendation_product_id, placement, producer, schema_version)
        values (${crypto.randomUUID()}::uuid, 'PRODUCT_VIEWED', ${profileId}::uuid, ${inStock}::uuid, 'home_trending', 'integration-test', 2)`;
    }
  });

  afterAll(async () => {
    await pg`delete from hero_events where slide_key like ${`hs-%`} or profile_id = ${profileId}::uuid`;
    await pg`delete from recommendation_events where profile_id = ${profileId}::uuid`;
    await pg`delete from experience_profiles where id = ${profileId}::uuid`;
    await pg`delete from products where category_id = ${categoryId}::uuid`;
    await pg`delete from categories where id = ${categoryId}::uuid`;
  });

  it('a null profile returns an empty-ish payload but still reports stock', async () => {
    const s = await signals.getSignals(null, [inStockSlug, outStockSlug]);
    expect(s.hasOrdered).toBe(false);
    expect(s.categoryAffinity).toEqual([]);
    expect(s.stockBySlug[inStockSlug]).toBe(true);
    expect(s.stockBySlug[outStockSlug]).toBe(false);
  });

  it('category affinity reflects what the profile actually browsed', async () => {
    const s = await signals.getSignals(profileId, [inStockSlug]);
    expect(s.categoryAffinity.length).toBeGreaterThan(0);
    expect(s.categoryAffinity[0].categorySlug).toBe(`hs-${suffix}`);
    // The preferred product is the in-stock one in that category.
    expect(s.preferredProduct?.categorySlug).toBe(`hs-${suffix}`);
    expect(s.preferredProduct?.imageUrl).toBe(`/products/${inStockSlug}.webp`);
  });

  it('never leaks PII — only slugs, counts, booleans and an image path', async () => {
    const s = await signals.getSignals(profileId, [inStockSlug]);
    const flat = JSON.stringify(s);
    expect(flat).not.toMatch(/@/); // no email
    expect(flat).not.toContain(profileId); // profile id is not echoed back
    expect(s.zone).toBeNull(); // honestly unavailable pre-checkout
  });

  it('E: an out-of-stock referenced SKU is reported false so the engine can gate it', async () => {
    const s = await signals.getSignals(profileId, [outStockSlug]);
    expect(s.stockBySlug[outStockSlug]).toBe(false);
  });

  it('telemetry records impressions and clicks and reports CTR only above the sample floor', async () => {
    const key = `hs${suffix.slice(0, 6)}`;
    // 3 impressions, 1 click — below the CTR floor, so CTR is withheld as noise.
    for (let i = 0; i < 3; i += 1) await telemetry.capture({ eventType: 'IMPRESSION', slideKey: key, position: 1, segment: 'new', profileId });
    await telemetry.capture({ eventType: 'CLICK', slideKey: key, position: 1, segment: 'new', profileId });
    const report = await telemetry.report(30);
    const row = report.slides.find((r) => r.slideKey === key);
    expect(row?.impressions).toBe(3);
    expect(row?.clicks).toBe(1);
    expect(row?.ctr).toBeNull(); // below the 100-impression floor
    await pg`delete from hero_events where slide_key = ${key}`;
  });

  it('telemetry refuses a junk event type or malformed slide key', async () => {
    expect((await telemetry.capture({ eventType: 'HACK', slideKey: 'x', position: 0, segment: 'new', profileId: null })).recorded).toBe(false);
    expect((await telemetry.capture({ eventType: 'CLICK', slideKey: 'Not A Key!', position: 0, segment: 'new', profileId: null })).recorded).toBe(false);
  });
});
