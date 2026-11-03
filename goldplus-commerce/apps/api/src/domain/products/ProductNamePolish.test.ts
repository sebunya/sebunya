import { describe, expect, it } from 'vitest';
import { polishProductName } from './ProductNamePolish';

describe('polishProductName', () => {
  it('never writes Type-Type-C', () => {
    expect(polishProductName('GoldPlus Cable TYPE C TO IPHONE')).toBe('GoldPlus Cable Type-C to iPhone');
    expect(polishProductName('GoldPlus Cable TYPE C TO C')).toBe('GoldPlus Cable Type-C to Type-C');
    expect(polishProductName('GoldPlus Cable C TO IPHONE')).toBe('GoldPlus Cable Type-C to iPhone');
    expect(polishProductName('GoldPlus Cable C TO C')).toBe('GoldPlus Cable Type-C to Type-C');
  });
  it('is stable on its own output', () => {
    for (const n of ['GoldPlus Cable TYPE C TO IPHONE', 'GoldPlus Cable TYPE C TO C', 'GoldPlus Charger TYPE C CH']) {
      const once = polishProductName(n);
      expect(polishProductName(once)).toBe(once);
    }
  });
  it('drops the category suffix and keeps other names', () => {
    expect(polishProductName('GoldPlus Power Bank GP-P07 PB')).toBe('GoldPlus Power Bank GP-P07');
    expect(polishProductName('GoldPlus Charger TYPE C CH')).toBe('GoldPlus Charger Type-C');
    expect(polishProductName('GoldPlus Cable TYPE PIN')).toBe('GoldPlus Cable Pin');
    expect(polishProductName('GoldPlus Mouse M1')).toBe('GoldPlus Mouse M1');
  });
});
