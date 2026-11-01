import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * 0189: the quote capture records how precisely the location was known and
 * the km to the area's point, and a later cost entry must not wipe them
 * (the repository only overwrites what the caller supplied).
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('delivery capture carries the accuracy facts (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  const orderId = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    const { DrizzleDeliveryCaptureRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleDeliveryCaptureRepository');
    repo = new DrizzleDeliveryCaptureRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from delivery_quote_capture where order_id = ${orderId}`;
    await raw.end({ timeout: 5 });
  });

  it('writes and reads accuracy_tier, centroid_km and centroid_expected_error_m', async () => {
    await repo.upsert({
      orderId,
      areaSlug: 'kampala-ntinda-10318',
      corridor: 'NTINDA',
      distanceBand: 'B2',
      quotedFeeUgx: 8000,
      centroidSource: 'parish_centroid',
      accuracyTier: 'AREA_POINT',
      centroidKm: 5.754,
      centroidExpectedErrorM: 412,
      straightLineKm: 11.5,
    });
    const row = await repo.findByOrderId(orderId);
    expect(row?.accuracyTier).toBe('AREA_POINT');
    expect(row?.centroidKm).toBe(5.75);
    expect(row?.centroidExpectedErrorM).toBe(412);
    expect(row?.centroidSource).toBe('parish_centroid');
  });

  it('a later cost entry leaves them in place', async () => {
    await repo.upsert({ orderId, actualRiderCostUgx: 6000 });
    const row = await repo.findByOrderId(orderId);
    expect(row?.actualRiderCostUgx).toBe(6000);
    expect(row?.accuracyTier).toBe('AREA_POINT');
    expect(row?.centroidKm).toBe(5.75);
  });
});
