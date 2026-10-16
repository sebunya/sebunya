import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';

/**
 * 0193 location signals against real PostgreSQL: consent decides the link (and the table's CHECK refuses a link
 * without it), "Deliver to" follows a signed-in customer across devices, the demand report joins signals to orders,
 * and the purge deletes rows past 13 months.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('location signals (real PostgreSQL)', () => {
  let raw: any;
  const tag = randomUUID().slice(0, 8);
  const slug = `test-ls-area-${tag}`;
  let consenting: string;
  let declining: string;
  let phoneProfile: string;
  let laptopProfile: string;
  let guestProfile: string;
  let store: any;
  let record: any;
  let getDeliverTo: any;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    [{ id: consenting }] = await raw`insert into users (email, password_hash) values (${`ls-yes-${tag}@example.test`}, 'x') returning id`;
    [{ id: declining }] = await raw`insert into users (email, password_hash) values (${`ls-no-${tag}@example.test`}, 'x') returning id`;
    await raw`insert into consent_current_state (user_id, personalization_granted) values (${consenting}, true), (${declining}, false)`;
    const profile = async (customer: string | null) =>
      (await raw`insert into experience_profiles (token_hash, customer_id) values (${createHash('sha256').update(randomUUID()).digest('hex')}, ${customer}) returning id`)[0].id;
    phoneProfile = await profile(consenting);
    laptopProfile = await profile(consenting);
    guestProfile = await profile(null);
    await raw`insert into delivery_corridor (area_slug, district, area, corridor, distance_band, access_mode, serviceable, centroid_lat, centroid_lng, centroid_source, centroid_expected_error_m)
      values (${slug}, 'Wakiso', ${`Ls Area ${tag}`}, 'kira_rd', 'B2', 'road', true, 0.389, 32.61, 'manual', 500)`;
    const { DrizzleLocationSignalStore } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleLocationSignalStore');
    const { RecordLocationSignalUseCase, GetDeliverToUseCase } = await import('../../apps/api/src/application/use-cases/locations/LocationSignalUseCases');
    store = new DrizzleLocationSignalStore();
    record = new RecordLocationSignalUseCase(store);
    getDeliverTo = new GetDeliverToUseCase(store);
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from location_signals where area_slug = ${slug}`;
    await raw`delete from experience_profiles where id in (${phoneProfile}, ${laptopProfile}, ${guestProfile})`;
    await raw`delete from consent_current_state where user_id in (${consenting}, ${declining})`;
    await raw`delete from delivery_corridor where area_slug = ${slug}`;
    await raw`delete from users where id in (${consenting}, ${declining})`;
    await raw.end({ timeout: 5 });
  });

  it('a consenting customer\'s signal is linked; a guest\'s is anonymous; the CHECK refuses a link without consent', async () => {
    await record.execute({ raw: { kind: 'deliver_to_set', surface: 'pdp', areaSlug: slug, district: 'Wakiso', label: 'Ls, Wakiso' }, profileId: phoneProfile, customerId: null });
    await record.execute({ raw: { kind: 'quote_shown', surface: 'pdp', areaSlug: slug, district: 'Wakiso', feeUgx: 6500 }, profileId: guestProfile, customerId: null });
    await record.execute({ raw: { kind: 'quote_shown', surface: 'cart', areaSlug: slug, district: 'Wakiso', feeUgx: 6500 }, profileId: null, customerId: declining });
    await record.execute({ raw: { kind: 'locate_offer_missed', surface: 'checkout', areaSlug: slug, district: 'Wakiso', pin: { lat: 0.4, lng: 32.62 } }, profileId: phoneProfile, customerId: null });
    const rows = await raw`select kind, profile_id, customer_id, personalisation, offer_km from location_signals where area_slug = ${slug} order by occurred_at`;
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ kind: 'deliver_to_set', profile_id: phoneProfile, customer_id: consenting, personalisation: true });
    expect(rows[1]).toMatchObject({ profile_id: null, customer_id: null, personalisation: false });
    expect(rows[2]).toMatchObject({ profile_id: null, customer_id: null, personalisation: false });
    expect(Number(rows[3].offer_km)).toBeGreaterThan(1);
    await expect(raw`insert into location_signals (kind, surface, customer_id, personalisation) values ('quote_shown', 'pdp', ${declining}, false)`).rejects.toThrow();
  });

  it('"Deliver to" set on the phone is there on the laptop of the same signed-in customer', async () => {
    const p = await getDeliverTo.execute({ profileId: laptopProfile, customerId: consenting });
    expect(p).toMatchObject({ areaSlug: slug, district: 'Wakiso', label: 'Ls, Wakiso' });
  });

  it('the demand report counts the area and the purge removes rows past 13 months', async () => {
    const rows = await store.demandByArea(30);
    const mine = rows.find((r: any) => r.areaSlug === slug);
    expect(mine).toMatchObject({ deliverToSets: 1, feeViews: 2, locateMissed: 1, medianFeeShownUgx: 6500 });
    expect(await store.areasConsidered(consenting, 90)).toEqual([{ label: expect.any(String), times: 1 }]);
    await raw`update location_signals set occurred_at = now() - interval '400 days' where area_slug = ${slug} and kind = 'quote_shown'`;
    const { purgePins } = await import('../../apps/api/src/scripts/geo-purge-pins');
    const r = await purgePins();
    expect(r.signals).toBeGreaterThanOrEqual(2);
    const left = await raw`select kind from location_signals where area_slug = ${slug}`;
    expect(left.map((x: any) => x.kind).sort()).toEqual(['deliver_to_set', 'locate_offer_missed']);
  });
});
