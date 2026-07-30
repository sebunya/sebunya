import { describe, it, expect } from 'vitest';
import { prepareCheckoutPayload } from '../../apps/web/src/lib/checkout';

/**
 * The delivery address was composed by interpolating optional location fields
 * directly, so a location missing a parish, a region or a postcode produced literal
 * "undefined" in the string:
 *
 *   deliveryArea    "undefined | undefined, Kampala"
 *   deliveryAddress "Plot 1, Harness Road | undefined · Postcode undefined"
 *
 * That string is what the delivery driver reads and what the admin sees on the
 * order. Only the district is guaranteed for a Uganda location, so every other part
 * is optional in practice.
 *
 * Nothing caught it: `${undefined}` is a valid string, so typecheck passed, the
 * build passed, and every component test passed. It was found by the end-to-end
 * harness looking at the row that actually landed in the database — which is why
 * this guard exists at the unit level now, where it is cheap to run.
 */

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const items = [{ productId: 'p1', quantity: 1, priceUgx: 1000, sku: 'S', name: 'N' }];

const base = {
  name: 'A Customer',
  email: 'a@example.test',
  phone: '+256700000000',
  deliveryAddress: 'Plot 1, Harness Road',
};

const prepare = (locationJson: unknown) =>
  prepareCheckoutPayload(
    form({ ...base, locationJson: JSON.stringify(locationJson) }),
    items as never,
  );

describe('a partially specified location never produces "undefined"', () => {
  it('handles a district-only location', () => {
    // The minimum a Uganda location picker can produce.
    const payload = prepare({ district: 'Kampala' });
    expect(payload.customerDetails.deliveryArea).not.toContain('undefined');
    expect(payload.customerDetails.deliveryAddress).not.toContain('undefined');
    expect(payload.customerDetails.deliveryArea).toBe('Kampala');
  });

  it('does not invent a postcode label when there is no postcode', () => {
    const payload = prepare({ district: 'Kampala', region: 'Central' });
    expect(payload.customerDetails.deliveryAddress).not.toContain('Postcode');
  });

  it('keeps the customer\'s own address line first and intact', () => {
    const payload = prepare({ district: 'Kampala' });
    expect(payload.customerDetails.deliveryAddress).toBe('Plot 1, Harness Road');
  });

  it('never produces a dangling separator', () => {
    for (const location of [
      { district: 'Kampala' },
      { district: 'Kampala', region: 'Central' },
      { district: 'Kampala', parishWard: 'Ward A' },
      { district: 'Kampala', subcountyDivisionTc: 'Division B' },
      { district: 'Kampala', postcode: '256' },
    ]) {
      const payload = prepare(location);
      for (const value of [payload.customerDetails.deliveryArea, payload.customerDetails.deliveryAddress]) {
        // A separator is fine BETWEEN two present parts; what must never appear is
        // one with nothing on a side, or two in a row, which is what an omitted
        // field used to leave behind.
        expect(value, JSON.stringify(location)).not.toMatch(/^\s*[|·]|[|·]\s*$/);
        expect(value, JSON.stringify(location)).not.toMatch(/[|·]\s*[|·]/);
        expect(value, JSON.stringify(location)).not.toContain('undefined');
      }
    }
  });
});

describe('a fully specified location still reads correctly', () => {
  const full = {
    district: 'Kampala',
    region: 'Central',
    countyOrMunicipality: 'Nakawa Division',
    subcountyDivisionTc: 'Nakawa',
    parishWard: 'Bugolobi',
    postcode: '256',
  };

  it('names the finest-grained parts in the delivery area', () => {
    const payload = prepare(full);
    expect(payload.customerDetails.deliveryArea).toBe('Bugolobi | Nakawa, Kampala');
  });

  it('appends the administrative detail after the customer\'s own line', () => {
    const payload = prepare(full);
    expect(payload.customerDetails.deliveryAddress).toBe(
      'Plot 1, Harness Road | Nakawa Division · Central · Postcode 256',
    );
  });

  it('carries the structured location through for server-side zone pricing', () => {
    // The string is for humans; the delivery fee is derived from this object, so
    // both must survive.
    const payload = prepare(full);
    expect(payload.customerDetails.deliveryLocation?.district).toBe('Kampala');
    expect(payload.customerDetails.deliveryLocation?.postcode).toBe('256');
  });
});

describe('an unusable location falls back rather than corrupting the address', () => {
  it('uses the raw submitted text when the location is not JSON', () => {
    const payload = prepareCheckoutPayload(
      form({ ...base, locationJson: 'Kampala', deliveryArea: 'Kampala' }),
      items as never,
    );
    expect(payload.customerDetails.deliveryAddress).not.toContain('undefined');
    expect(payload.customerDetails.deliveryAddress).toContain('Plot 1, Harness Road');
  });

  it('uses the raw submitted text when the JSON is malformed', () => {
    const payload = prepareCheckoutPayload(
      form({ ...base, locationJson: '{not valid json', deliveryArea: 'Kampala' }),
      items as never,
    );
    expect(payload.customerDetails.deliveryAddress).toBe('Plot 1, Harness Road');
  });
});
