import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BatteryFinderUseCases } from '../../apps/api/src/application/use-cases/batteries/BatteryFinderUseCases';
import type { PublicFitRow } from '../../apps/api/src/application/ports/IBatteryFinderRepository';

/**
 * The finder must say what the product page it links to says: the units a
 * customer can still buy (stock minus reservations) and today's campaign price.
 */

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

const product = { productId: 'p1', slug: 'bl-5c', name: 'BL-5C battery', canonicalCode: 'BL-5C', imageUrl: null, priceUgx: 45_000, capacityMah: 1020, nominalVoltageMv: 3700 };
const device = { id: 'd1', slug: 'nokia-1100', brandName: 'Nokia', seriesName: null, model: '1100', modelNumber: null, variant: null, label: 'Nokia 1100', releaseYear: null, verifiedFits: 1, listedFits: 0 };

function fit(over: Partial<PublicFitRow> = {}): PublicFitRow {
  return {
    claimId: 'c1', productId: 'p1', deviceId: 'd1', evidenceStatus: 'PACKAGE_VERIFIED', workflowStatus: 'ACTIVE', publicCondition: null,
    batteryLifecycle: 'ACTIVE', productApproved: true, productActive: true, stockQuantity: 3, floorPriceUgx: 38_000,
    product, device, ...over,
  };
}

function campaign(percentBps: number) {
  const now = Date.now();
  return {
    listActiveVersions: async () => [{
      definition: { name: 'Sale' },
      version: {
        conditions: [], exclusions: [], couponCode: null, priceFloorUgx: 0,
        schedule: { startsAt: new Date(now - 60_000), endsAt: new Date(now + 3_600_000) },
        benefits: [{ type: 'PERCENTAGE_OFF', value: percentBps, maximumDiscountUgx: null, targetProductIds: null }],
      },
    }] as never,
  };
}

function finder(rows: PublicFitRow[], pricing?: ReturnType<typeof campaign>) {
  const repo = {
    getConfig: async () => null,
    deviceBySlug: async () => device,
    fitsForDevice: async () => rows,
    recordEvent: async () => undefined,
  };
  return new BatteryFinderUseCases(repo as never, {} as never, {} as never, 'pepper', pricing);
}

describe('battery finder stock and price', () => {
  it('the repository reads stock minus reservations, never on-hand stock', () => {
    const src = read('apps/api/src/infrastructure/db/repositories/DrizzleBatteryFinderRepository.ts');
    expect(src).toMatch(/GREATEST\(\$\{products\.stockQuantity\} - \$\{products\.reservedQuantity\}, 0\)/);
    expect(src).not.toMatch(/stockQuantity: products\.stockQuantity/);
  });

  it('with every unit reserved the fit is out of stock, not "in stock"', async () => {
    const out = await finder([fit({ stockQuantity: 0 })]).device('nokia-1100');
    expect(out.results[0].fitState).toBe('VERIFIED_OUT_OF_STOCK');
    expect(out.results[0].inStock).toBe(false);
  });

  it('quotes the campaign price, with the regular price only when it drops', async () => {
    const out = await finder([fit()], campaign(1000)).device('nokia-1100');
    expect(out.results[0].priceUgx).toBe(40_500);
    expect(out.results[0].regularPriceUgx).toBe(45_000);
  });

  it('holds a product at its floor and does not announce a saving that is not there', async () => {
    const out = await finder([fit({ floorPriceUgx: 45_000 })], campaign(1000)).device('nokia-1100');
    expect(out.results[0].priceUgx).toBe(45_000);
    expect(out.results[0].regularPriceUgx).toBeNull();
  });

  it('never copies Price A into the public result', async () => {
    const out = await finder([fit()], campaign(1000)).device('nokia-1100');
    expect(JSON.stringify(out.results)).not.toMatch(/floor/i);
  });

  it('without a pricing reader it quotes the catalogue price', async () => {
    const out = await finder([fit()]).device('nokia-1100');
    expect(out.results[0].priceUgx).toBe(45_000);
    expect(out.results[0].regularPriceUgx).toBeNull();
  });
});

/**
 * Searching by battery code must say the same thing the phone pages say. A
 * battery that is sold but whose record has not passed its readiness gate is
 * listed on phone pages as "awaiting verification" (owner policy 2026-10-12);
 * typing its code must not answer "not available online yet".
 */
import { normaliseBatteryCode } from '../../apps/api/src/domain/batteries/BatteryCodes';
import { DEFAULT_BATTERY_FINDER_CONFIG } from '@goldplus/shared';

function codeFinder(opts: { lifecycle: 'ACTIVE' | 'REVIEW'; showAwaiting: boolean }) {
  const row = fit({ batteryLifecycle: opts.lifecycle, evidenceStatus: 'SUPPLIER_LISTED' });
  const repo = {
    getConfig: async () => ({ config: { ...DEFAULT_BATTERY_FINDER_CONFIG, showAwaitingVerification: opts.showAwaiting }, version: 1 }),
    deviceCandidates: async () => [],
    batteryCandidates: async () => [{ productId: 'p1', canonicalCodeNormalised: normaliseBatteryCode('BL-5C'), supplierCodeNormalised: null, barcode: null, aliasesNormalised: [], lifecycleStatus: opts.lifecycle }],
    batteryPublic: async () => ({ ...product, lifecycleStatus: opts.lifecycle, stockQuantity: 3, floorPriceUgx: 38_000, productApproved: true, productActive: true }),
    fitsForBattery: async () => [row],
    fuzzyDevices: async () => [],
    fuzzyBatteries: async () => [],
    recordEvent: async () => undefined,
  };
  return new BatteryFinderUseCases(repo as never, {} as never, {} as never, 'pepper');
}

describe('battery finder: search by code agrees with the phone pages', () => {
  it('a sellable battery whose record is not yet active answers as awaiting verification, with its listed phones marked', async () => {
    const out = await codeFinder({ lifecycle: 'REVIEW', showAwaiting: true }).search('BL-5C');
    expect(out.kind).toBe('BATTERY');
    if (out.kind !== 'BATTERY') return;
    expect(out.battery.fitState).toBe('AWAITING_VERIFICATION');
    expect(out.devices.map((d) => [d.slug, d.fitState])).toEqual([['nokia-1100', 'AWAITING_VERIFICATION']]);
  });

  it('with awaiting fits hidden, the same code still says the battery is not online yet', async () => {
    const out = await codeFinder({ lifecycle: 'REVIEW', showAwaiting: false }).search('BL-5C');
    expect(out.kind).toBe('NO_RESULT');
  });

  it('an active record keeps its verified, stock-aware answer', async () => {
    const out = await codeFinder({ lifecycle: 'ACTIVE', showAwaiting: true }).search('BL-5C');
    expect(out.kind).toBe('BATTERY');
    if (out.kind !== 'BATTERY') return;
    expect(out.battery.fitState).toBe('VERIFIED_IN_STOCK');
  });
});
