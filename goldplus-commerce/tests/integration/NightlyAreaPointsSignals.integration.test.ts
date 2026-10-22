import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';

/**
 * The nightly area-point job reads "Locate me" choices from location_signals, a PUBLIC endpoint. Before 2026-10-22 five
 * rows with the same pin and no stated accuracy (one family pressing Locate me five times, or one script) moved an
 * area's priced point overnight, with distance pricing live. Now: one pin per known visitor, and only a stated fix of
 * 100 m or better. Dry run: nothing is written to the corridor.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

suite('nightly area points from Locate me signals (real PostgreSQL)', () => {
  let raw: any;
  let run: any;
  const tag = randomUUID().slice(0, 8);
  const slug = `test-nap-${tag}`;
  const profiles: string[] = [];

  beforeAll(async () => {
    process.env.DATABASE_URL = URL!;
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('../../apps/api/node_modules/postgres')(URL!, { max: 2, prepare: false });
    await raw`insert into delivery_corridor (area_slug, district, area, corridor, distance_band, access_mode, serviceable)
      values (${slug}, 'Kampala', ${`Nap ${tag}`}, 'test_rd', 'B2', 'road', true)`;
    for (let i = 0; i < 5; i++) {
      profiles.push((await raw`insert into experience_profiles (token_hash) values (${createHash('sha256').update(randomUUID()).digest('hex')}) returning id`)[0].id);
    }
    ({ runNightlyAreaPoints: run } = await import('../../apps/api/src/scripts/geo-nightly-area-points'));
  });

  afterAll(async () => {
    if (!raw) return;
    await raw`delete from location_signals where area_slug = ${slug}`;
    await raw`delete from delivery_corridor where area_slug = ${slug}`;
    await raw`delete from experience_profiles where id = any(${profiles})`;
    await raw.end({ timeout: 5 });
  });

  const signal = (profileId: string, accuracy: number | null) => raw`
    insert into location_signals (kind, surface, area_slug, pin_lat, pin_lng, pin_accuracy_m, profile_id)
    values ('locate_offer_chosen', 'checkout', ${slug}, 0.3601, 32.6101, ${accuracy}, ${profileId})`;

  it('five presses by one visitor, without an accuracy, move nothing', async () => {
    for (let i = 0; i < 5; i++) await signal(profiles[0], null);
    for (let i = 0; i < 5; i++) await signal(profiles[0], 20);
    expect((await run({ dryRun: true })).written).toBe(0);
  });

  it('five different visitors with a good fix still teach the area its point', async () => {
    for (const p of profiles.slice(1)) await signal(p, 20);
    expect((await run({ dryRun: true })).written).toBe(1);
  });
});
