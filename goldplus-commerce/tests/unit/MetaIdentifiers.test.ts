import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  isMetaBrowserId, isMetaClickId, metaBrowserIdFromVisitor, metaCity, metaClickIdFromParam, metaCountry, metaCustomerHashes, metaNamePart, splitCustomerName,
} from '../../apps/api/src/domain/advertising/MetaIdentifiers';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Meta's match keys, built to Meta's documented formats. The shop runs no
 * Pixel, so nothing sets `_fbc` or `_fbp`: the click id is built from the
 * landing URL's fbclid and the browser id is derived from our own visitor id.
 */
describe('Meta click id (fbc)', () => {
  it('is fb.1.<first observed ms>.<fbclid>, with the fbclid exactly as received', () => {
    // Case is significant: Meta says never to lower- or upper-case it.
    const fbclid = 'IwAR2xQzAbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789';
    expect(metaClickIdFromParam(fbclid, 1790841536221)).toBe(`fb.1.1790841536221.${fbclid}`);
    expect(metaClickIdFromParam(fbclid, 1790841536221.9)).toBe(`fb.1.1790841536221.${fbclid}`);
    expect(isMetaClickId(metaClickIdFromParam(fbclid, 1790841536221))).toBe(true);
  });
  it('refuses what is not a click id, rather than forwarding it', () => {
    for (const bad of ['', 'short', 'has space in it xx', '<script>alert(1)</script>', 'a'.repeat(501), null, undefined, 42]) expect(metaClickIdFromParam(bad, 1790841536221), String(bad)).toBeNull();
    expect(metaClickIdFromParam('IwAR2xQzAbCdEfGh', 0)).toBeNull();
    expect(metaClickIdFromParam('IwAR2xQzAbCdEfGh', NaN)).toBeNull();
    for (const bad of ['fb.1.1790841536221', 'fb.1.abc.IwAR2xQzAbCdEfGh', 'fb.1.1790841536221.has space', 'gb.1.1790841536221.IwAR2xQzAbCdEfGh', '', null]) expect(isMetaClickId(bad), String(bad)).toBe(false);
  });
});

describe('Meta browser id (fbp) without a Pixel', () => {
  const fp = 'fp.1790841536221.fa7903b5-a629-4083-9121-715539a7c550';
  it('is derived from the visitor id: same browser, same id, in Meta\'s format', () => {
    const a = metaBrowserIdFromVisitor(fp)!;
    expect(a).toMatch(/^fb\.1\.1790841536221\.[1-9]\d{9}$/);
    expect(isMetaBrowserId(a)).toBe(true);
    expect(metaBrowserIdFromVisitor(fp)).toBe(a);                       // stable: nothing is stored
    expect(metaBrowserIdFromVisitor('fp.1790841536221.00000000-0000-4000-8000-000000000000')).not.toBe(a);
  });
  it('is not invented for an id of another shape', () => {
    for (const bad of ['', 'fp.1.abc', 'GA1.2.123.456', 'fp.notatime.fa7903b5-a629-4083-9121-715539a7c550', null, undefined]) expect(metaBrowserIdFromVisitor(bad), String(bad)).toBeNull();
  });
});

describe('Meta customer details from an order', () => {
  it('normalises names as Meta hashes them: lower case, letters only, accents folded', () => {
    expect(metaNamePart('  Nakato ')).toBe('nakato');
    expect(metaNamePart("O'Brien-Smith")).toBe('obriensmith');
    expect(metaNamePart('Élodie')).toBe('elodie');
    expect(metaNamePart('123')).toBeNull();
    expect(metaNamePart('')).toBeNull();
  });
  it('splits the one name field into first and last, without guessing a family name from one word', () => {
    expect(splitCustomerName('Sarah Nakato')).toEqual({ first: 'sarah', last: 'nakato' });
    expect(splitCustomerName('  Mr.  John  Paul   Okello ')).toEqual({ first: 'john', last: 'okello' });
    expect(splitCustomerName('Dr Amina')).toEqual({ first: 'amina', last: null });
    expect(splitCustomerName('Okello')).toEqual({ first: 'okello', last: null });
    expect(splitCustomerName('  ')).toEqual({ first: null, last: null });
    expect(splitCustomerName(null)).toEqual({ first: null, last: null });
  });
  it('normalises the district as a city and the country as a lower-case ISO code', () => {
    expect(metaCity('Wakiso')).toBe('wakiso');
    expect(metaCity('Fort Portal')).toBe('fortportal');
    expect(metaCity("Kampala (Central)")).toBe('kampalacentral');
    expect(metaCity('K')).toBeNull();
    expect(metaCountry('UG')).toBe('ug');
    expect(metaCountry(' ug ')).toBe('ug');
    for (const bad of ['Uganda', 'UGA', '', null]) expect(metaCountry(bad), String(bad)).toBeNull();
  });
  it('hashes exactly what the order states, and nothing it does not', () => {
    expect(metaCustomerHashes({ customerName: 'Sarah Nakato', city: 'Wakiso', country: 'UG' })).toEqual({
      hashed_first_name: sha('sarah'), hashed_last_name: sha('nakato'), hashed_city: sha('wakiso'), hashed_country: sha('ug'),
    });
    expect(metaCustomerHashes({ customerName: 'Okello', city: null, country: 'UG' })).toEqual({ hashed_first_name: sha('okello'), hashed_country: sha('ug') });
    expect(metaCustomerHashes({})).toEqual({});
  });
});
