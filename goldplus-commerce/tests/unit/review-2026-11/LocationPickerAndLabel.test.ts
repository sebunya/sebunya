import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { keepPinOnCommit } from '../../../apps/web/src/lib/locationPickerPin';
import { formatLocationLabel } from '../../../apps/web/src/lib/location-utils';

describe('the picker drops a stale pin when a different area is committed', () => {
  const offered = ['kampala-ntinda', 'kampala-kiwatule'];
  it('a typed area outside the offered set drops a rough phone fix', () => {
    expect(keepPinOnCommit({ pinSource: 'device', offeredAreaSlugs: offered, chosenAreaSlug: 'wakiso-entebbe', chosenFromPin: false })).toBe(false);
    expect(keepPinOnCommit({ pinSource: 'pasted_link', offeredAreaSlugs: offered, chosenAreaSlug: 'wakiso-entebbe', chosenFromPin: false })).toBe(false);
  });
  it('an offered area, a pin-derived choice, a Google building, or a pin with no nearby offer is kept', () => {
    expect(keepPinOnCommit({ pinSource: 'device', offeredAreaSlugs: offered, chosenAreaSlug: 'kampala-ntinda', chosenFromPin: false })).toBe(true);
    expect(keepPinOnCommit({ pinSource: 'device', offeredAreaSlugs: offered, chosenAreaSlug: 'x', chosenFromPin: true })).toBe(true);
    expect(keepPinOnCommit({ pinSource: 'map_place', offeredAreaSlugs: offered, chosenAreaSlug: 'x', chosenFromPin: false })).toBe(true);
    expect(keepPinOnCommit({ pinSource: 'device', offeredAreaSlugs: null, chosenAreaSlug: 'x', chosenFromPin: false })).toBe(true);
  });
  it('clearing the answer dispatches change (typing and the Change button)', () => {
    const src = readFileSync(join(__dirname, '../../../apps/web/src/lib/locationPickerClient.ts'), 'utf8');
    expect(src).toMatch(/function clearPayload\(\)[\s\S]{0,200}dispatchEvent\(new Event\('change'/);
    expect(src).not.toMatch(/payloadInput\.value = '';/);
    expect(src).toMatch(/keepPinOnCommit\(/);
  });
});

describe('formatLocationLabel keeps written directions', () => {
  it('manual payload keeps rawAddressText with the district', () => {
    expect(formatLocationLabel(JSON.stringify({ manual: true, rawAddressText: 'Behind Total, Kyebando', district: 'Wakiso' }))).toBe('Behind Total, Kyebando (Wakiso)');
    expect(formatLocationLabel(JSON.stringify({ manual: true, rawAddressText: 'Near the mosque' }))).toBe('Near the mosque');
  });
  it('picker shape unchanged', () => {
    expect(formatLocationLabel(JSON.stringify({ district: 'Wakiso', area: 'Najjera', displayLabel: 'Najjera, Wakiso' }))).toBe('Najjera, Wakiso');
  });
});
