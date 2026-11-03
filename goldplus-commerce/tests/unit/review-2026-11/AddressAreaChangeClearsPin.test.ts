import { describe, it, expect } from 'vitest';
import { areaChangeClears } from '../../../apps/api/src/infrastructure/db/repositories/DrizzleAddressRepository';

describe('moving a saved address to another area drops the old pin', () => {
  const target = { areaSlug: 'wakiso-najjera', district: 'WAKISO' };
  it('clears pin and snapshot on a new area', () => {
    const c = areaChangeClears(target, { areaSlug: 'wakiso-entebbe' });
    expect(c).toMatchObject({ gpsLat: null, gpsLng: null, gpsSource: null, snapshotAreaLabel: null });
  });
  it('clears on a new district', () => {
    expect(areaChangeClears(target, { district: 'KAMPALA' })).toMatchObject({ gpsLat: null });
  });
  it('keeps a pin sent with the move, still drops the snapshot', () => {
    const c = areaChangeClears(target, { areaSlug: 'wakiso-entebbe', gpsLat: 0.05, gpsLng: 32.46 });
    expect(c.gpsLat).toBeUndefined();
    expect(c.snapshotAreaLabel).toBeNull();
  });
  it('the same area changes nothing', () => {
    expect(areaChangeClears(target, { areaSlug: 'wakiso-najjera', district: 'Wakiso', landmarkText: 'x' })).toEqual({});
  });
});
