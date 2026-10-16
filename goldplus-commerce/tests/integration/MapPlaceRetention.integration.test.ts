import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/**
 * 2026-10-16: buildings picked from Google Places at checkout. Google's terms allow their coordinates to be kept
 * 30 days at most and their place IDs indefinitely. The nightly purge must remove exactly those coordinates (on
 * orders and saved addresses) after 29 days, keep the place ID, and leave every customer-owned pin alone.
 * Also runs nearestAreas (checkout's "Locate me" and building pick) against real PostgreSQL for the first time.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('Google-derived coordinates are purged after 29 days (real PostgreSQL)', () => {
  let raw: any;
  const tag = randomUUID().slice(0, 8);
  // A number no other suite uses: the pin repository suite matches open orders by phone.
  const phone = `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const slug = `test-mp-area-${tag}`;
  let userId: string;
  const orders: Record<string, string> = {};
  const addrs: Record<string, string> = {};
  const DAY = 86_400_000;

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    [{ id: userId }] = await raw`insert into users (email, password_hash) values (${`mp-${tag}@example.test`}, 'x') returning id`;
    await raw`insert into delivery_corridor (area_slug, district, area, corridor, distance_band, access_mode, serviceable, centroid_lat, centroid_lng, centroid_source, centroid_expected_error_m)
      values (${slug}, 'Kampala', ${`Mp Area ${tag}`}, 'kira_rd', 'B2', 'road', true, -1.900000, 29.100000, 'manual', 500)`;
    const order = async (key: string, loc: Record<string, unknown>, ageDays: number) => {
      [{ id: orders[key] }] = await raw`insert into orders (order_number, user_id, customer_name, customer_phone, delivery_area, delivery_address, delivery_location, subtotal_amount, total_amount, status, payment_status, created_at)
        values (${`MP${tag}${key.slice(0, 4)}${ageDays}`}, ${userId}, 'Mp Tester', ${phone}, 'Kololo', 'Acacia Mall', ${raw.json(loc)}, 1000, 1000, 'processing', 'paid', ${new Date(Date.now() - ageDays * DAY)}) returning id`;
    };
    const place = { district: 'Kampala', gpsLat: 0.3378, gpsLng: 32.5946, gpsSource: 'map_place', placeId: 'ChIJtestPlaceId123' };
    await order('oldPlace', place, 31);
    await order('newPlace', place, 3);
    await order('oldDevice', { district: 'Kampala', gpsLat: 0.33, gpsLng: 32.59, gpsAccuracyM: 12, gpsSource: 'device' }, 60);
    const address = async (key: string, source: string, ageDays: number) => {
      [{ id: addrs[key] }] = await raw`insert into addresses (user_id, label, recipient_name, phone, district, area_details, gps_lat, gps_lng, gps_source, gps_captured_at)
        values (${userId}, ${key}, 'Mp Tester', ${phone}, 'Kampala', 'Acacia Mall', 0.3378, 32.5946, ${source}, ${new Date(Date.now() - ageDays * DAY)}) returning id`;
    };
    await address('oldPlace', 'map_place', 30);
    await address('newPlace', 'map_place', 2);
    await address('oldDevice', 'device', 90);
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from addresses where user_id = ${userId}`;
    await raw`delete from orders where user_id = ${userId}`;
    await raw`delete from delivery_corridor where area_slug = ${slug}`;
    await raw`delete from users where id = ${userId}`;
    await raw.end({ timeout: 5 });
  });

  it('removes map_place coordinates older than 29 days, keeps the place ID, and touches nothing else', async () => {
    const { purgePins } = await import('../../apps/api/src/scripts/geo-purge-pins');
    const r = await purgePins();
    expect(r.mapPlaceOrders).toBeGreaterThanOrEqual(1);
    expect(r.mapPlaceAddresses).toBeGreaterThanOrEqual(1);

    const loc = async (key: string) => (await raw`select delivery_location from orders where id = ${orders[key]}`)[0].delivery_location;
    const oldPlace = await loc('oldPlace');
    expect(oldPlace.gpsLat).toBeUndefined();
    expect(oldPlace.gpsLng).toBeUndefined();
    expect(oldPlace.placeId).toBe('ChIJtestPlaceId123');
    expect(oldPlace.district).toBe('Kampala');
    expect((await loc('newPlace')).gpsLat).toBe(0.3378);
    expect((await loc('oldDevice')).gpsLat).toBe(0.33);

    const addr = async (key: string) => (await raw`select gps_lat from addresses where id = ${addrs[key]}`)[0].gps_lat;
    expect(await addr('oldPlace')).toBeNull();
    expect(Number(await addr('newPlace'))).toBeCloseTo(0.3378, 4);
    expect(Number(await addr('oldDevice'))).toBeCloseTo(0.3378, 4);
  });

  it('nearestAreas returns our nearest serviceable areas with km, closest first', async () => {
    const { DeliveryAreaResolver } = await import('../../apps/api/src/infrastructure/delivery/DeliveryAreaResolver');
    // The test area sits far from any real Ugandan area (south-west corner), so it is the only one within reach.
    const near = await new DeliveryAreaResolver().nearestAreas({ lat: -1.905, lng: 29.1 });
    expect(near[0]).toMatchObject({ areaSlug: slug, district: 'Kampala' });
    expect(near[0].km).toBeLessThan(1);
    expect(await new DeliveryAreaResolver().nearestAreas({ lat: -1.9, lng: 29.5 })).toEqual([]);
  });
});
