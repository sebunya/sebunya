import { describe, it, expect } from 'vitest';
import {
  parseCoordinatesFromUrl,
  ResolveMapLinkUseCase,
} from '../../apps/api/src/application/use-cases/locations/LocationUseCases';

/**
 * PART G.1 pasted-link parsing — every documented shape, plus rejection of
 * out-of-Uganda coordinates and garbage.
 */
describe('parseCoordinatesFromUrl', () => {
  it('bare lat,lng pair', () => {
    expect(parseCoordinatesFromUrl('0.34714, 32.58252')).toMatchObject({ lat: 0.34714, lng: 32.58252 });
  });
  it('maps.google.com/?q=lat,lng', () => {
    expect(parseCoordinatesFromUrl('https://maps.google.com/?q=0.3476,32.5825')).toMatchObject({ lat: 0.3476, lng: 32.5825 });
  });
  it('google.com/maps/@lat,lng,zoom', () => {
    expect(parseCoordinatesFromUrl('https://www.google.com/maps/@0.3163,32.5822,15z')).toMatchObject({ lat: 0.3163, lng: 32.5822 });
  });
  it('place URL with !3d!4d data segment', () => {
    expect(
      parseCoordinatesFromUrl('https://www.google.com/maps/place/Ntinda/data=!3d0.3541!4d32.6185'),
    ).toMatchObject({ lat: 0.3541, lng: 32.6185 });
  });
  it('ll= and query= parameters', () => {
    expect(parseCoordinatesFromUrl('https://maps.google.com/maps?ll=0.05,32.46')).toMatchObject({ lat: 0.05, lng: 32.46 });
    expect(parseCoordinatesFromUrl('https://www.google.com/maps/search/?api=1&query=0.61,32.47')).toMatchObject({ lat: 0.61, lng: 32.47 });
  });
  it('rejects coordinates far outside Uganda (parse artefacts)', () => {
    expect(parseCoordinatesFromUrl('51.5,-0.12')).toBeNull(); // London
    expect(parseCoordinatesFromUrl('https://maps.google.com/?q=40.71,-74.0')).toBeNull(); // NYC
  });
  it('rejects garbage without throwing', () => {
    expect(parseCoordinatesFromUrl('')).toBeNull();
    expect(parseCoordinatesFromUrl('not a link')).toBeNull();
    expect(parseCoordinatesFromUrl('https://example.com/nothing')).toBeNull();
  });
});

describe('ResolveMapLinkUseCase — short links', () => {
  it('resolves a goo.gl short link through the resolver port then parses', async () => {
    const uc = new ResolveMapLinkUseCase({
      resolve: async () => 'https://www.google.com/maps/@0.3476,32.5825,17z',
    });
    expect(await uc.execute('https://maps.app.goo.gl/AbCdEf')).toMatchObject({ lat: 0.3476, lng: 32.5825 });
  });
  it('does not call the resolver for non-shortener hosts', async () => {
    let called = false;
    const uc = new ResolveMapLinkUseCase({
      resolve: async () => {
        called = true;
        return null;
      },
    });
    expect(await uc.execute('https://evil.example.com/redirect')).toBeNull();
    expect(called).toBe(false);
  });
  it('a dead short link yields null, never a guess', async () => {
    const uc = new ResolveMapLinkUseCase({ resolve: async () => null });
    expect(await uc.execute('https://goo.gl/dead')).toBeNull();
  });
});
