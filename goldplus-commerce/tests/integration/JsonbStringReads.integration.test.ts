import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

/**
 * drizzle 0.29 + postgres-js store a plain `jsonb()` column written with `.values({ col: obj })` as a jsonb STRING,
 * and `col->>'key'` on a string is NULL: reports read blank and nothing fails. Each case writes a row THROUGH THE
 * REAL DRIZZLE WRITER (so it has the shape production has), proves it is a string, then reads it through the fixed
 * reader. Measured on local copies 2026-10-20: audit_logs.new_state, products.specifications, order_attribution
 * .click_ids and outbox_events.payload are strings.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('raw SQL reads of jsonb stored as a string (real PostgreSQL)', () => {
  let raw: any; let db: any; let schema: any;
  const tag = `js${Date.now().toString(36)}`;
  const auditIds: string[] = []; const productIds: string[] = []; const categoryIds: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    ({ db } = await import('../../apps/api/src/infrastructure/db/client'));
    schema = await import('../../apps/api/src/infrastructure/db/schema');
  });
  afterAll(async () => {
    if (!raw) return;
    // audit_logs is append-only in the database (by design); its test rows stay.
    if (productIds.length) await raw`delete from products where id = any(${productIds})`;
    if (categoryIds.length) await raw`delete from categories where id = any(${categoryIds})`;
    await raw.end({ timeout: 5 });
  });

  it('delivery: a skipped order mirror is found and described (audit_logs.new_state)', async () => {
    const taskId = crypto.randomUUID();
    const [row] = await db.insert(schema.auditLogs).values({
      action: 'FULFILMENT_DELIVERY_RECORDED', entity: 'fulfilment_task', entityId: taskId,
      newState: { outcome: 'delivered', orderTransition: 'skipped' },
    }).returning({ id: schema.auditLogs.id });
    auditIds.push(row.id);
    const [{ t }] = await raw`select jsonb_typeof(new_state) as t from audit_logs where id = ${row.id}`;
    expect(t).toBe('string'); // the shape production has

    const { DrizzleDeliveryCaptureRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleDeliveryCaptureRepository');
    const skipped = await new DrizzleDeliveryCaptureRepository().listSkippedMirrors(500);
    const mine = skipped.find((s: any) => s.fulfilment_task_id === taskId);
    expect(mine).toMatchObject({ attempted_outcome: 'delivered', order_transition: 'skipped' });

    const { DrizzleDeliveryCalibrationRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleDeliveryCalibrationRepository');
    const counts: any = await new DrizzleDeliveryCalibrationRepository().counts();
    expect(Number(counts.skipped_mirrors ?? counts.skippedMirrors)).toBeGreaterThanOrEqual(1);
  });

  it('products: specifications written by drizzle are counted (products.specifications)', async () => {
    const [cat] = await db.insert(schema.categories).values({ name: `Jsonb ${tag}`, slug: `jsonb-cat-${tag}` } as never).returning({ id: schema.categories.id });
    categoryIds.push(cat.id);
    const [p] = await db.insert(schema.products).values({
      categoryId: cat.id,
      name: `Jsonb ${tag}`, slug: `jsonb-${tag}`, sku: `JS-${tag}`.slice(0, 40), modelNumber: `JS-${tag}`.slice(0, 40), priceUgx: 1000,
      categoryName: 'Jsonb test', shortDescription: 'Jsonb test product', stockStatus: 'in_stock', stockQuantity: 0,
      specifications: { capacity: '10000mAh', ports: 2 },
    } as never).returning({ id: schema.products.id });
    productIds.push(p.id);
    const [{ t }] = await raw`select jsonb_typeof(specifications) as t from products where id = ${p.id}`;
    expect(t).toBe('string');
    const { DrizzleProductQualityRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleProductQualityRepository');
    const scanned = await new DrizzleProductQualityRepository().scanProducts(5000);
    const mine: any = scanned.find((s: any) => s.productId === p.id);
    expect(mine?.specificationsCount ?? mine?.specifications_count).toBe(2);
  });
});
