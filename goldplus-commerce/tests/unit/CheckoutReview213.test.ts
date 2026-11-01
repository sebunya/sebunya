import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prepareCheckoutPayload, resolveCheckedAddressId, savedAddressPlace } from '../../apps/web/src/lib/checkout';
import { isPickupPayload } from '../../apps/web/src/lib/deliveryQuotePanel';

const page = readFileSync(path.resolve(__dirname, '../../apps/web/src/pages/checkout.astro'), 'utf8');

describe('checkout review fixes (213, 212)', () => {
  it('the manual-address branch keeps the duplicate-order key', () => {
    const fd = new FormData();
    fd.set('name', 'A'); fd.set('phone', '0772123456');
    fd.set('locationJson', JSON.stringify({ manual: true, rawAddressText: 'Near the market' }));
    fd.set('clientOrderKey', 'key-12345678');
    expect(prepareCheckoutPayload(fd, [{ productId: 'p', quantity: 1 } as never]).clientOrderKey).toBe('key-12345678');
  });

  it('switching back to delivery clears the pickup payload (client and server)', () => {
    expect(isPickupPayload(JSON.stringify({ manual: true, pickupPointId: 'pp1', rawAddressText: 'Pickup point: shop' }))).toBe(true);
    expect(isPickupPayload(JSON.stringify({ manual: true, rawAddressText: 'Near the market' }))).toBe(false);
    expect(isPickupPayload('')).toBe(false);
    expect(isPickupPayload('{bad')).toBe(false);
    expect(page).toMatch(/if \(pickup\) applyPickupSelection\(\);\s*else clearPickupPayload\(\);/);
    expect(page).toMatch(/if \(!collecting && isPickupPayload\(values\.locationJson\)\)/);
  });

  it('a re-render checks the posted address, not the default', () => {
    expect(resolveCheckedAddressId(null, ['a', 'b'], 'a')).toBe('a');
    expect(resolveCheckedAddressId('', ['a', 'b'], 'a')).toBe('');
    expect(resolveCheckedAddressId('b', ['a', 'b'], 'a')).toBe('b');
    expect(resolveCheckedAddressId('someone-elses', ['a', 'b'], 'a')).toBe('a');
    expect(page).toMatch(/checked=\{a\.id === checkedAddressId\}/);
    expect(page).toMatch(/value="" checked=\{checkedAddressId === ''\}/);
  });

  it('the same-items CHECKOUT_ALREADY_ORDERED path empties the basket, and drops the intent once paid', () => {
    const branch = page.slice(page.indexOf("} else if (result.code === 'CHECKOUT_ALREADY_ORDERED' && result.existingOrder) {"));
    const head = branch.slice(0, branch.indexOf('startPayment('));
    expect(head).toMatch(/await clearBasketAfterOrder\(\);/);
    expect(head).toMatch(/if \(paid\) clearCheckoutIntent\(Astro\.cookies\);/);
  });

  it('the UNKNOWN-session and cross-site re-render keeps what the customer typed', () => {
    expect(page).toMatch(/if \(Astro\.request\.method === 'POST' && \(!originDecision\.allowed \|\| sessionUnknown\)\) \{[\s\S]{0,200}values = valuesFromForm\(formData\);/);
  });

  it('a new saved address keeps the area and a non-Google pin it was quoted by', () => {
    expect(savedAddressPlace({ district: 'Wakiso', areaSlug: 'najjera', gpsLat: 0.37, gpsLng: 32.6, gpsSource: 'device', gpsAccuracyM: 12 }))
      .toEqual({ areaSlug: 'najjera', gpsLat: 0.37, gpsLng: 32.6, gpsSource: 'device', gpsAccuracyM: 12 });
    // Google Places coordinates are not kept in the address book.
    expect(savedAddressPlace({ district: 'Wakiso', areaSlug: 'najjera', gpsLat: 0.37, gpsLng: 32.6, gpsSource: 'map_place' })).toEqual({ areaSlug: 'najjera' });
    expect(savedAddressPlace(null)).toEqual({});
    expect(page).toMatch(/\.\.\.savedAddressPlace\(payload\.customerDetails\.deliveryLocation\),/);
  });
});
