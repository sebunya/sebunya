import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { effectivePinRetentionDays } from '../../../apps/api/src/domain/delivery/DeliveryPins';

const src = (p: string) => readFileSync(join(__dirname, '../../../apps/api/src', p), 'utf8');

describe('pin retention: stricter is honoured, never longer than the privacy page', () => {
  it('a 14-day setting stays 14, broken values fall back to 180, nothing past 365', () => {
    expect(effectivePinRetentionDays(14)).toBe(14);
    expect(effectivePinRetentionDays(180)).toBe(180);
    expect(effectivePinRetentionDays(Number.NaN)).toBe(180);
    expect(effectivePinRetentionDays(0)).toBe(180);
    expect(effectivePinRetentionDays(1000)).toBe(365);
  });
  it('the nightly purge and the area-point learner use it, and signal coordinates go at the pin cutoff', () => {
    const purge = src('scripts/geo-purge-pins.ts');
    expect(purge).toMatch(/effectivePinRetentionDays\(retention\)/);
    expect(purge).toMatch(/update location_signals set pin_lat = null[\s\S]*occurred_at < \$\{cutoff\}/);
    expect(src('scripts/geo-nightly-area-points.ts')).toMatch(/effectivePinRetentionDays\(retentionDays\)/);
  });
  it('the privacy page promise is 180 days and the default matches', () => {
    const page = readFileSync(join(__dirname, '../../../apps/web/src/pages/privacy.astro'), 'utf8');
    expect(page).toMatch(/We keep it for 180 days/);
    expect(src('domain/delivery/DeliveryConfigRegistry.ts')).toMatch(/key: 'pin_retention_days',[\s\S]{0,120}defaultValue: 180/);
  });
});
