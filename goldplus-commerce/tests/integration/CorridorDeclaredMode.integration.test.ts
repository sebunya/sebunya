import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * Ops can set an area to unserviceable / pickup only / bus parcel in the corridor file (Control Centre). The apply
 * wrote delivery_corridor.fulfilment_mode and audited it, but the resolver never read the column and quoting always
 * passed declaredMode: null, so quotes kept pricing a rider (2026-10-22 review). Real PostgreSQL resolver.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('the corridor file mode reaches the quote (real PostgreSQL)', () => {
  let raw: any;
  let resolver: any;
  let resolveFulfilmentMode: any;
  const tag = randomUUID().slice(0, 8);
  const pickup = `test-cdm-p-${tag}`;
  const plain = `test-cdm-r-${tag}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    await raw`insert into delivery_corridor (area_slug, district, area, corridor, distance_band, access_mode, serviceable, fulfilment_mode)
      values (${pickup}, 'Kampala', ${`Cdm P ${tag}`}, 'test_rd', 'B1', 'road', true, 'pickup_only'),
             (${plain}, 'Kampala', ${`Cdm R ${tag}`}, 'test_rd', 'B1', 'road', true, null)`;
    const { DeliveryAreaResolver } = await import('../../apps/api/src/infrastructure/delivery/DeliveryAreaResolver');
    ({ resolveFulfilmentMode } = await import('../../apps/api/src/domain/delivery/DeliveryFulfilmentMode'));
    resolver = new DeliveryAreaResolver();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from delivery_corridor where area_slug in (${pickup}, ${plain})`;
    await raw.end({ timeout: 5 });
  });

  it('an area set to pickup only is quoted as pickup only, whatever its band says', async () => {
    const r = await resolver.forOrderLocation({ areaSlug: pickup });
    expect(r.input.declaredFulfilmentMode).toBe('pickup_only');
    expect(resolveFulfilmentMode({ ...r.input, declaredMode: r.input.declaredFulfilmentMode }, 'B4')).toBe('pickup_only');
  });

  it('an area with no override is still derived (own rider within the ceiling)', async () => {
    const r = await resolver.forOrderLocation({ areaSlug: plain });
    expect(r.input.declaredFulfilmentMode).toBeNull();
    expect(resolveFulfilmentMode({ ...r.input, declaredMode: null }, 'B4')).toBe('own_rider');
  });
});
