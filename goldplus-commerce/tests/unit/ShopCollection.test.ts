import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isShopCollectionOperator } from '../../apps/api/src/domain/locations/CollectionPoints';
import { classifyDependencyError } from '../../apps/api/src/application/ports/CheckoutDependencyOutcomes';

/**
 * 2026-10-16: the checkout promised "collect free from our shop" but had no
 * collection option, and a collection order would have been told a rider will
 * call about a delivery fee. Collection is now a zero-fee method the server
 * confirms, and carrier stages upcountry never appear as a free pickup.
 */
describe('shop collection', () => {
  it('our shops and partner counters are collection points; carrier offices are not', () => {
    expect(isShopCollectionOperator('goldplus_shop')).toBe(true);
    expect(isShopCollectionOperator('partner_counter')).toBe(true);
    expect(isShopCollectionOperator('bus_parcel_office')).toBe(false);
    expect(isShopCollectionOperator('BUS_PARCEL_OFFICE')).toBe(false);
    expect(isShopCollectionOperator('')).toBe(false);
    expect(isShopCollectionOperator(null)).toBe(false);
  });
  it('an unavailable collection point is a terminal refusal, not a retry', () => {
    expect(classifyDependencyError(new Error('PICKUP_POINT_UNAVAILABLE: That collection point is not available.'))?.code).toBe('DELIVERY_NOT_SUPPORTED');
  });
  it('the whole path is wired: API accepts the id, the quote prices it at zero, the list filters carriers, the page sends it', () => {
    const root = resolve(__dirname, '../..');
    const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
    expect(read('apps/api/src/interfaces/http/routes/commerce.ts')).toMatch(/pickupPointId: z\.string\(\)\.uuid\(\)/);
    const registry = read('apps/api/src/infrastructure/Registry.ts');
    expect(registry).toMatch(/if \(input\.pickupPointId\)/);
    expect(registry).toMatch(/isShopCollectionOperator\(point\.operator\)/);
    expect(registry).toMatch(/feeUgx: 0,\s*\n\s*freeDeliveryThresholdUgx: null/);
    expect(read('apps/api/src/application/use-cases/commerce/CheckoutUseCase.ts')).toMatch(/pickupPointId: dto\.customerDetails\.pickupPointId/);
    expect(read('apps/api/src/interfaces/http/routes/locations.ts')).toMatch(/p\.active && isShopCollectionOperator\(p\.operator\)/);
    const page = read('apps/web/src/pages/checkout.astro');
    expect(page).toMatch(/pickupPointId: pickupPoint\.id/);
    expect(page).toMatch(/pickupPointId: opt\.value/);
    expect(page).toMatch(/renderEstimate\(\{ kind: 'CONFIRMED', feeUgx: 0 \}, true\)/);
  });
});
