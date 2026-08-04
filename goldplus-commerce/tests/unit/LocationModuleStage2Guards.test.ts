import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { UGANDA_DISTRICTS, UGANDA_PLACE_ALIASES } from '../../packages/shared/src/locations/uganda';
import { canTransitionOrder, isTerminalOrderStatus } from '../../apps/api/src/domain/commerce/OrderStateMachine';
import { prepareCheckoutPayload } from '../../apps/web/src/lib/checkout';

const root = path.resolve(__dirname, '../..');

/**
 * Location-module stage 2 guards.
 */
describe('anti-resurrection: the deleted wrong-data gazetteer must never return', () => {
  // ~12 stale branches still carry the 45,753-line dataset; a careless merge
  // resurrects provably wrong delivery data. This test makes that merge red.
  const FORBIDDEN = [
    'apps/web/public/data/uganda-locations-final.json',
    'apps/web/public/data/uganda-locations.xlsx',
    'apps/web/public/data/uganda-location-master-raw.csv',
    'apps/web/src/lib/location-search.ts',
    'temp_source.json',
    'scripts/parse-locations.mjs',
    'scripts/qa-release-e2e.ts',
    'scripts/search-harness.ts',
  ];
  for (const f of FORBIDDEN) {
    it(`${f} stays deleted`, () => {
      expect(fs.existsSync(path.join(root, f))).toBe(false);
    });
  }
  it('the dead gazetteer types are not exported from @goldplus/shared', () => {
    const index = fs.readFileSync(path.join(root, 'packages/shared/src/index.ts'), 'utf8');
    expect(index).not.toContain("types/locations");
  });
});

describe('alias table integrity (gap left by the deleted gazetteer suite)', () => {
  it('UGANDA_PLACE_ALIASES has no duplicate area keys', () => {
    const seen = new Map<string, string>();
    for (const { area, district } of UGANDA_PLACE_ALIASES) {
      const key = area.trim().toUpperCase();
      if (seen.has(key)) {
        throw new Error(`duplicate alias "${area}" (${seen.get(key)} vs ${district})`);
      }
      seen.set(key, district);
    }
  });
  it('no alias shadows a district name', () => {
    const districts = new Set(UGANDA_DISTRICTS.map((d) => d.toUpperCase()));
    for (const { area } of UGANDA_PLACE_ALIASES) {
      expect(districts.has(area.trim().toUpperCase())).toBe(false);
    }
  });
});

describe('checkout payload resilience (restores the deleted Suite B assertion)', () => {
  it('malformed locationJson never throws and falls back to raw fields', () => {
    const fd = new Map<string, string>([
      ['name', 'T'],
      ['phone', '0700000000'],
      ['locationJson', '{ NOT REAL JSON!'],
      ['deliveryArea', 'Ntinda, Kampala'],
      ['deliveryAddress', 'Near the stage'],
    ]);
    const formData = { get: (k: string) => fd.get(k) ?? null } as unknown as FormData;
    const payload = prepareCheckoutPayload(formData, []);
    expect(payload.customerDetails.deliveryArea).toContain('Ntinda');
  });
});

describe('order lifecycle: the delivery leg (stage 2 scope addition)', () => {
  const paid = { paymentStatus: 'paid' as const };
  it('processing → dispatched → delivered', () => {
    expect(canTransitionOrder('processing', 'dispatched', paid).allowed).toBe(true);
    expect(canTransitionOrder('dispatched', 'delivered', paid).allowed).toBe(true);
    expect(isTerminalOrderStatus('delivered')).toBe(true);
  });
  it('a failed attempt is not terminal: re-dispatch, complete, or cancel', () => {
    expect(canTransitionOrder('dispatched', 'delivery_failed', paid).allowed).toBe(true);
    expect(canTransitionOrder('delivery_failed', 'dispatched', paid).allowed).toBe(true);
    expect(canTransitionOrder('delivery_failed', 'cancelled', paid).allowed).toBe(true);
    expect(isTerminalOrderStatus('delivery_failed')).toBe(false);
  });
  it('the delivery leg cannot bypass processing or resurrect a terminal order', () => {
    expect(canTransitionOrder('received', 'dispatched', paid).allowed).toBe(false);
    expect(canTransitionOrder('delivered', 'dispatched', paid).allowed).toBe(false);
    expect(canTransitionOrder('completed', 'dispatched', paid).allowed).toBe(false);
    expect(canTransitionOrder('dispatched', 'cancelled', paid).allowed).toBe(false);
  });
});

describe('gazetteer dataset gates (run once data/locations/v1 is committed)', () => {
  const dataDir = path.join(root, 'data/locations/v1');
  const hasData = fs.existsSync(path.join(dataDir, 'uganda_locations_master.csv'));

  it.skipIf(!hasData)('exactly one vocabulary district has zero areas, and it is Terego', () => {
    const csv = fs.readFileSync(path.join(dataDir, 'uganda_locations_master.csv'), 'utf8');
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const dIdx = header.findIndex((h) => h === 'current_district' || h === 'district');
    expect(dIdx).toBeGreaterThanOrEqual(0);
    const districtsInData = new Set(
      lines.slice(1).map((l) => l.split(',')[dIdx]?.trim()).filter(Boolean),
    );
    const zeroArea = UGANDA_DISTRICTS.filter(
      (d) => ![...districtsInData].some((x) => x.toUpperCase() === d.toUpperCase()),
    );
    expect(zeroArea).toEqual(['Terego']);
  });

  it(`dataset presence is ${hasData ? 'CONFIRMED' : 'STILL PENDING (import blocked, see progress log)'}`, () => {
    expect(true).toBe(true);
  });
});
