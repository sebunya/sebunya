import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_BUSINESS_INFO, SHOP_LOCATION } from '@goldplus/shared';
import { haversineKm, validateOriginCoordinates } from '../../apps/api/src/domain/delivery/DeliveryOrigin';

/**
 * The shop's position, fixed 2026-10-03 from the owner's photos: 4th floor of
 * the Zainab Aziza Building, Burton Street face. One constant feeds the
 * footer defaults, the JSON-LD geo, the shop page and the migration that moves
 * the dispatch origin, so they cannot drift apart.
 */
const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('SHOP_LOCATION', () => {
  it('is inside Uganda and within 150 m of the old Uhuru Restaurant origin', () => {
    expect(validateOriginCoordinates(SHOP_LOCATION.latitude, SHOP_LOCATION.longitude)).toEqual({ ok: true });
    const km = haversineKm({ lat: 0.31333, lng: 32.5775 }, { lat: SHOP_LOCATION.latitude, lng: SHOP_LOCATION.longitude });
    expect(km).toBeGreaterThan(0.05);
    expect(km).toBeLessThan(0.15);
  });

  it('is the address the footer defaults and the map link describe', () => {
    expect(DEFAULT_BUSINESS_INFO.addressLine1).toContain(SHOP_LOCATION.building);
    expect(DEFAULT_BUSINESS_INFO.addressLine1).toContain(SHOP_LOCATION.floor);
    expect(DEFAULT_BUSINESS_INFO.addressLine1).toContain(SHOP_LOCATION.street);
    expect(DEFAULT_BUSINESS_INFO.mapUrl).toBe(SHOP_LOCATION.mapUrl);
    expect(SHOP_LOCATION.mapUrl).toMatch(/^https:\/\/maps\.google\.com\/\?cid=\d+$/);
  });

  it('moves the dispatch origin and the stored address to the same point (0168)', () => {
    const sql = read('apps/api/src/infrastructure/db/migrations/0168_shop_location_burton_street.sql');
    expect(sql).toContain(`latitude = ${SHOP_LOCATION.latitude.toFixed(6)}`);
    expect(sql).toContain(`longitude = ${SHOP_LOCATION.longitude.toFixed(6)}`);
    // 0168 named the building wrongly; 0173 (owner, 2026-10-06) corrects the name only.
    const fix = read('apps/api/src/infrastructure/db/migrations/0173_shop_building_zainab_aziza.sql');
    expect(fix).toContain(`jsonb_build_object('addressLine1', '${DEFAULT_BUSINESS_INFO.addressLine1}')`);
    expect(fix).toContain("config->>'addressLine1' = 'New Pioneer Mall Building, 4th Floor, Burton Street, Kampala'");
    expect(fix).toContain("AND street = 'New Pioneer Mall Building, 4th Floor, Burton Street'");
    expect(sql).toContain(`'mapUrl', '${SHOP_LOCATION.mapUrl}'`);
    // Guarded: only the imported values are replaced, an operator edit is kept.
    expect(sql).toContain("AND latitude = 0.313330 AND longitude = 32.577500");
    expect(sql).toContain("config->>'addressLine1' = 'Wilson Road, Kampala'");
    const journal = JSON.parse(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json'));
    // Registered (not necessarily the newest: 0169 followed on 2026-10-06).
    expect(journal.entries.map((e: { tag: string }) => e.tag)).toContain('0168_shop_location_burton_street');
  });

  it('publishes the point as GeoCoordinates on the Store and the shop page', () => {
    for (const p of ['apps/web/src/components/SiteJsonLd.astro', 'apps/web/src/pages/locations/zainab-aziza.astro']) {
      const src = read(p);
      expect(src).toContain("'@type': 'GeoCoordinates'");
      expect(src).toContain('SHOP_LOCATION.latitude');
      expect(src).toContain('SHOP_LOCATION.longitude');
    }
  });

  it('tells a collecting customer the building and floor', () => {
    const reg = read('apps/api/src/domain/delivery/DeliveryConfigRegistry.ts');
    expect(reg).toContain("'Collect free from GoldPlus, 4th Floor, Zainab Aziza Building, Burton Street, next to Uhuru Restaurant, opposite Pioneer Mall.'");
  });

  it('sends the old Wilson Road slug to the new shop page with a 301, in the middleware', () => {
    // astro.config `redirects` never fired under the node adapter (404 on the
    // built server, 2026-10-05), so the redirect must be in the middleware.
    const mw = read('apps/web/src/middleware.ts');
    expect(mw).toContain("'/locations/wilson-road': '/locations/zainab-aziza'");
    expect(mw).toContain("'/locations/new-pioneer-mall': '/locations/zainab-aziza'");
    expect(mw).toMatch(/context\.redirect\(`\$\{moved\}\$\{context\.url\.search\}`, 301\)/);
    expect(read('apps/web/astro.config.mjs')).not.toContain('wilson-road');
  });
});
