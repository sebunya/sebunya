import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitDraftValues } from '../../../apps/api/src/interfaces/http/deliveryDraftValues';
import { parseAdminNumber } from '../../../apps/web/src/lib/adminNumber';

const web = (p: string) => readFileSync(join(__dirname, '../../../apps/web/src', p), 'utf8');

describe('delivery launch draft keeps the rider-limit band', () => {
  it('own_rider_max_band sent inside values is kept as a string, numbers stay numbers', () => {
    const r = splitDraftValues({ minimum_fee_ugx: '5,000', own_rider_max_band: 'B4', blank: '' }, undefined);
    expect(r.values).toEqual({ minimum_fee_ugx: 5000 });
    expect(r.stringValues).toEqual({ own_rider_max_band: 'B4' });
  });
  it('explicit stringValues are kept', () => {
    expect(splitDraftValues({}, { own_rider_max_band: ' B2 ' }).stringValues).toEqual({ own_rider_max_band: 'B2' });
  });
  it('the wizard posts the derived stringValues with the draft', () => {
    expect(web('pages/admin/delivery/launch.astro')).toMatch(/stringValues: json\.data\.stringValues/);
  });
});

describe('admin numbers never travel as NaN', () => {
  it('accepts thousands separators and refuses junk', () => {
    expect(parseAdminNumber('1,200')).toEqual({ ok: true, value: 1200 });
    expect(parseAdminNumber('1 200')).toEqual({ ok: true, value: 1200 });
    expect(parseAdminNumber('0.85')).toEqual({ ok: true, value: 0.85 });
    expect(parseAdminNumber('5k').ok).toBe(false);
    expect(parseAdminNumber('UGX 5000').ok).toBe(false);
    expect(parseAdminNumber('').ok).toBe(false);
  });
  it('calibration edit refuses a value that is not a number', () => {
    const page = web('pages/admin/delivery/calibration.astro');
    expect(page).toMatch(/parseAdminNumber\(editedRaw\)/);
    expect(page).not.toMatch(/[^A-Za-z]Number\(editedRaw\)/);
  });
});
