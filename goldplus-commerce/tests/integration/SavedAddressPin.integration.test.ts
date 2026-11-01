import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

/** pinForUser (2026-10-22): an order placed from a saved address takes its pin, only from the customer's own address. */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('the pin of a saved address (real PostgreSQL)', () => {
  let raw: any; let repo: any;
  const tag = randomUUID().slice(0, 8);
  let owner = ''; let other = ''; let addr = ''; let bare = '';

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    [{ id: owner }] = await raw`insert into users (email, password_hash) values (${`sap-a-${tag}@example.test`}, 'x') returning id`;
    [{ id: other }] = await raw`insert into users (email, password_hash) values (${`sap-b-${tag}@example.test`}, 'x') returning id`;
    [{ id: addr }] = await raw`insert into addresses (user_id, label, recipient_name, phone, district, area_details, gps_lat, gps_lng, gps_accuracy_m, gps_source, gps_captured_at)
      values (${owner}, 'Home', 'A', '0772000000', 'Kampala', 'Ntinda', 0.3561, 32.6122, 15, 'device', now()) returning id`;
    [{ id: bare }] = await raw`insert into addresses (user_id, label, recipient_name, phone, district, area_details)
      values (${owner}, 'Work', 'A', '0772000000', 'Kampala', 'Town') returning id`;
    const { DrizzleAddressRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleAddressRepository');
    repo = new DrizzleAddressRepository();
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from addresses where user_id in (${owner}, ${other})`;
    await raw`delete from users where id in (${owner}, ${other})`;
    await raw.end({ timeout: 5 });
  });

  it('the owner gets the pin', async () => {
    expect(await repo.pinForUser(owner, addr)).toMatchObject({ gpsLat: 0.3561, gpsLng: 32.6122, gpsAccuracyM: 15, gpsSource: 'device' });
  });
  it('another customer naming the address gets nothing', async () => {
    expect(await repo.pinForUser(other, addr)).toBeNull();
  });
  it('an address with no pin gives none', async () => {
    expect(await repo.pinForUser(owner, bare)).toBeNull();
  });
});
