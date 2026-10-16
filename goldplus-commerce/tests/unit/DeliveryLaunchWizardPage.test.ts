import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The setup wizard must ASK for everything the derive call REQUIRES. On
 * 2026-10-16 the owner answered all seven questions and the api refused every
 * attempt with "That place is not in the metro area set", because the page
 * never asked which area is the furthest a rider goes (riderLimitAreaSlug) and
 * posted an empty string. This pins the page to the api's contract.
 */
const page = readFileSync(resolve(__dirname, '../../apps/web/src/pages/admin/delivery/launch.astro'), 'utf8');
const route = readFileSync(resolve(__dirname, '../../apps/api/src/interfaces/http/routes/admin/delivery.ts'), 'utf8');

describe('setup wizard page matches the derive contract', () => {
  it('asks for, echoes and posts the rider-limit area', () => {
    expect(route).toMatch(/riderLimitAreaSlug: String\(body\?\.riderLimitAreaSlug/);
    expect(page).toMatch(/name="riderLimitAreaSlug"/);
    expect(page).toMatch(/riderLimitAreaSlug: answers\.riderLimitAreaSlug/);
    expect(page).toMatch(/intent === "search-limit"/);
  });
  it('expert mode can set the rider ceiling, a mandatory launch value', () => {
    expect(page).toMatch(/name="own_rider_max_band"/);
    expect(page).toMatch(/values\.own_rider_max_band = s\("own_rider_max_band"\)/);
  });
});
