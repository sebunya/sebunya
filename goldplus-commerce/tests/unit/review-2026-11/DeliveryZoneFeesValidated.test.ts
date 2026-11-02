import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateBandPolicy } from '../../../apps/api/src/domain/commerce/DeliveryFeePrediction';

const page = readFileSync(join(__dirname, '../../../apps/web/src/pages/admin/pricing/delivery-zones.astro'), 'utf8');

describe('delivery-zone band fees are validated', () => {
  it('the page refuses blank or junk band fees before saving', () => {
    expect(page).toMatch(/const bad = BANDS\.filter/);
    expect(page).toMatch(/if \(bad\.length > 0\)/);
    expect(page.indexOf('if (bad.length > 0)')).toBeLessThan(page.indexOf('/admin/delivery-zones/policy'));
  });
  it('the API refuses a null band (NaN serialised)', () => {
    const ok = { coreFeeUgx: 5000, cityFeeUgx: 5000, metroFeeUgx: 6000, metroEdgeFeeUgx: 7000, nearFeeUgx: 8000, midFeeUgx: 9000, farFeeUgx: 10000, remoteFeeUgx: 12000, enabled: true };
    expect(validateBandPolicy(ok)).toBeNull();
    expect(validateBandPolicy({ ...ok, midFeeUgx: null as any })).toMatch(/midFeeUgx/);
  });
});
