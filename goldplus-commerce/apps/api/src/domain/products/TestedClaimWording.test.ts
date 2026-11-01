import { describe, expect, it } from 'vitest';
import { stripClaim } from './TestedClaimWording';

describe('stripClaim', () => {
  it('keeps the delivery promise that followed the claim', () => {
    expect(stripClaim('Fits every socket in Uganda. Every unit is tested before it is sold; same-day delivery in Kampala and Wakiso.'))
      .toBe('Fits every socket in Uganda. Same-day delivery in Kampala and Wakiso.');
    expect(stripClaim('We confirm the fit before you pay. Every unit is tested before it is sold, with same-day delivery in Kampala and Wakiso.'))
      .toBe('We confirm the fit before you pay. Same-day delivery in Kampala and Wakiso.');
  });
  it('drops the short-description tag and the fit variant', () => {
    expect(stripClaim('Wall charger, model GP-C06, UK plug. Tested before sale.')).toBe('Wall charger, model GP-C06, UK plug.');
    expect(stripClaim('Replacement battery for the Pop 5, model GP-49FX. Tested before sale; fit confirmed before you pay.'))
      .toBe('Replacement battery for the Pop 5, model GP-49FX. Not sure it fits? Ask us and we confirm it before you order.');
    expect(stripClaim('GoldPlus charger, model GP-C12. Every unit is tested before it is sold. Same-day delivery in Kampala and Wakiso.'))
      .toBe('GoldPlus charger, model GP-C12. Same-day delivery in Kampala and Wakiso.');
  });
  it('never leaves the bare fit promise behind (review 2026-10-29)', () => {
    expect(stripClaim('Battery, model GP-49FX. Tested before sale; fit confirmed before you pay.')).not.toMatch(/fit confirmed before you pay/i);
  });
  it('leaves text without the claim alone', () => {
    expect(stripClaim('USB-C cable, model GP-L06C.')).toBe('USB-C cable, model GP-L06C.');
  });
});
