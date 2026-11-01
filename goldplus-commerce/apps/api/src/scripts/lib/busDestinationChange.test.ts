import { describe, expect, it } from 'vitest';
import { busDestinationChanged } from './busDestinationChange';

const base = { matching_district: 'Gulu', region: 'Northern', current_zone: null, areas_in_district: 3, notes: null };
describe('busDestinationChanged', () => {
  it('sees notes and areas_in_district edits', () => {
    expect(busDestinationChanged(base, { ...base, notes: 'Via Karuma' })).toBe(true);
    expect(busDestinationChanged(base, { ...base, areas_in_district: 4 })).toBe(true);
  });
  it('treats a driver string and a number as the same value', () => {
    expect(busDestinationChanged({ ...base, areas_in_district: '3' }, base)).toBe(false);
  });
});
