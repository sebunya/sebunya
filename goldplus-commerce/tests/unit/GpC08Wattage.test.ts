import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { rewriteTwelveWatts, rewriteTwelveWattsDeep } from '../../apps/api/src/domain/products/ChargerWattageCorrection';

describe('GP-C08 is 10W, not 12W (outputs 5V⎓2A, 9V⎓1A)', () => {
  it('rewrites 12W and 12 W, and nothing else', () => {
    expect(rewriteTwelveWatts('GoldPlus GP-C08 12W USB Fast Charger, 2A (UK plug)')).toBe('GoldPlus GP-C08 10W USB Fast Charger, 2A (UK plug)');
    expect(rewriteTwelveWatts('Output power: 12 W')).toBe('Output power: 10 W');
    expect(rewriteTwelveWatts('120W, 12Wh, 212W, 5V⎓2A')).toBe('120W, 12Wh, 212W, 5V⎓2A');
  });

  it('fixes the Output power spec in either stored shape', () => {
    expect(rewriteTwelveWattsDeep([{ name: 'Output power', value: '12', unit: 'W' }, { name: 'Output', value: '5V⎓2A, 9V⎓1A' }]))
      .toEqual([{ name: 'Output power', value: '10', unit: 'W' }, { name: 'Output', value: '5V⎓2A, 9V⎓1A' }]);
    expect(rewriteTwelveWattsDeep({ 'Output power': '12 W', Ports: 'USB-A' })).toEqual({ 'Output power': '10 W', Ports: 'USB-A' });
    expect(rewriteTwelveWattsDeep({ 'Output power': 12 })).toEqual({ 'Output power': 10 });
  });

  it('the seed files no longer say 12W for GP-C08', () => {
    for (const f of ['apps/api/src/scripts/data/supplier-specs-2026-09.json', 'apps/api/src/scripts/data/seo-metadata-review-2026-10-12.json']) {
      const t = readFileSync(f, 'utf8');
      const i = t.indexOf('GP-C08');
      expect(t.slice(Math.max(0, i - 400), i + 1500), f).not.toMatch(/\b12 ?W\b|"Output power",\s*"value": "12"/);
    }
  });
});
