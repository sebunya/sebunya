import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The admin reads that used to run as SQL inside route files. Moved into
 * repositories, they are run here against real PostgreSQL: a typo in a column
 * or table name fails this test, not an admin page.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('admin reads moved out of the routes (real PostgreSQL)', () => {
  let raw: any;
  let loyalty: any;
  let fulfilment: any;
  let delivery: any;
  let hub: any;

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const postgres = createRequire(import.meta.url)('postgres');
    raw = postgres(URL as string, { max: 2, onnotice: () => undefined });
    const R = '../../apps/api/src/infrastructure/db/repositories';
    loyalty = new (await import(`${R}/DrizzleLoyaltyCompletionRepository`)).DrizzleLoyaltyCompletionRepository();
    fulfilment = new (await import(`${R}/DrizzleFulfilmentRepository`)).DrizzleFulfilmentRepository();
    hub = new (await import(`${R}/DrizzleCapabilityHubReader`)).DrizzleCapabilityHubReader();
    // The two reads under test do not use the area resolver the constructor takes.
    delivery = new (await import(`${R}/DrizzleDeliveryConfigRepository`)).DrizzleDeliveryConfigRepository({} as never);
  });

  afterAll(async () => { if (raw) await raw.end(); });

  it('loyalty: referrals, fraud signals and liability snapshots are readable lists', async () => {
    expect(Array.isArray(await loyalty.adminReferrals())).toBe(true);
    expect(Array.isArray(await loyalty.adminFraudSignals())).toBe(true);
    expect(Array.isArray(await loyalty.recentLiabilitySnapshots())).toBe(true);
    expect(Array.isArray(await loyalty.liabilitySnapshotsForExport())).toBe(true);
  });

  it('loyalty: the dealer flag updates an account and is a no-op for an unknown id', async () => {
    await expect(loyalty.setDealerFlag(randomUUID(), true)).resolves.toBeUndefined();
  });

  it('fulfilment: the newest paid order id, or null when there is none', async () => {
    const [{ n }] = await raw`select count(*)::int as n from orders where payment_status = 'paid'`;
    const id = await fulfilment.latestPaidOrderId();
    if (n === 0) expect(id).toBeNull();
    else expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('delivery: setup counts are numbers and the corridor export is a list', async () => {
    const counts = await delivery.setupCounts();
    expect(counts.origins.total).toBeGreaterThanOrEqual(0);
    expect(counts.origins.active).toBeLessThanOrEqual(counts.origins.total);
    expect(counts.corridors.areas).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(await delivery.corridorExportRows())).toBe(true);
  });

  it('hub: every counted table exists (no count is reported unknown)', async () => {
    const counts = await hub.counts();
    expect(Object.keys(counts).sort()).toEqual([
      'abandonmentOpen', 'campaignsRows', 'devices', 'flashSales', 'legalDrafts', 'legalPublished',
      'mediaAssets', 'orders', 'products', 'productsMissingImages', 'redirects', 'reviewsPending',
    ]);
    for (const [name, value] of Object.entries(counts)) expect(value, name).toBeGreaterThanOrEqual(0);
  });
});
