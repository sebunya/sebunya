import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/** Upcountry shipping (0192): the versioned supersede and the collection-point upsert, against real PostgreSQL. */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('bus rate card admin repository (real PostgreSQL)', () => {
  let raw: any;
  let repo: any;
  let quoting: any;
  const tag = randomUUID().slice(0, 8);
  const carrier = `Test Taxi ${tag}`;
  const town = `Testtown${tag}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    const { DrizzleBusRateCardAdminRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleBusRateCardAdminRepository');
    const { DrizzleDeliveryQuotingRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleDeliveryQuotingRepository');
    repo = new DrizzleBusRateCardAdminRepository();
    quoting = new DrizzleDeliveryQuotingRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from delivery_bus_rate_card where carrier = ${carrier}`;
    await raw`delete from ug_pickup_point where carrier = ${carrier}`;
    await raw.end({ timeout: 5 });
  });

  it('a new price closes the previous card and opens the next version; the quote reads kind and handover point', async () => {
    const base = { carrier, destinationTown: town, destinationDistrict: 'Mukono', parcelClass: 'small' as const, insurancePctOfDeclaredValue: null, transitDaysMin: 0, transitDaysMax: 0, chargedAt: 'collection' as const, sourceNote: 'test', createdBy: null, carrierKind: 'taxi' as const, handoverPoint: 'the taxi stage' };
    const v1 = await repo.supersedeCard({ ...base, feeUgx: 8000, now: new Date('2026-10-16T05:00:00Z') });
    expect(v1).toMatchObject({ version: 1, carrierKind: 'taxi', handoverPoint: 'the taxi stage', effectiveTo: null });
    const v2 = await repo.supersedeCard({ ...base, feeUgx: 9000, now: new Date('2026-10-20T05:00:00Z') });
    expect(v2.version).toBe(2);
    const cards = (await repo.listCards()).filter((c: any) => c.carrier === carrier);
    const closed = cards.find((c: any) => c.version === 1);
    expect(closed.effectiveTo).toEqual(new Date('2026-10-20T05:00:00Z'));
    const current = await quoting.cardsFor({ town, district: 'Mukono' });
    const live = current.filter((c: any) => c.effectiveTo === null);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ feeUgx: 9000, carrierKind: 'taxi', handoverPoint: 'the taxi stage' });
    expect(await repo.expireCard(v2.id, new Date('2026-10-21T05:00:00Z'))).toBe(true);
    expect(await repo.expireCard(v2.id, new Date('2026-10-22T05:00:00Z'))).toBe(false);
  });

  it('a collection point is one row per carrier and town, updated on save, switchable', async () => {
    const o1 = await repo.upsertOffice({ carrier, name: 'Stage A', town, district: 'Mukono', physicalAddress: null, landmarkText: 'by the market', phone: null, departureTimes: null, collectionWindow: null, active: true });
    const o2 = await repo.upsertOffice({ carrier, name: 'Stage A (moved)', town, district: 'Mukono', physicalAddress: 'Main St', landmarkText: null, phone: null, departureTimes: '07:00', collectionWindow: null, active: true });
    expect(o2.id).toBe(o1.id);
    expect(o2.name).toBe('Stage A (moved)');
    const mine = (await repo.listOffices()).filter((o: any) => o.carrier === carrier);
    expect(mine).toHaveLength(1);
    expect(await repo.setOfficeActive(o1.id, false)).toBe(true);
    const office = await quoting.officeFor({ town, district: 'Mukono' });
    expect(office).toBeNull(); // inactive offices are not offered to customers
  });
});
