import { describe, it, expect } from 'vitest';
import { offerPriceUgx } from '../../apps/web/src/lib/offerPrice';

describe('offerPriceUgx — structured data carries the price the customer sees', () => {
  it('uses the sale price while a campaign has actually reduced it', () => {
    expect(offerPriceUgx(15000, 13500)).toBe(13500);
  });
  it('keeps the regular price when there is no sale, or the "sale" is not a reduction', () => {
    expect(offerPriceUgx(15000, null)).toBe(15000);
    expect(offerPriceUgx(15000, undefined)).toBe(15000);
    expect(offerPriceUgx(15000, 15000)).toBe(15000);
    expect(offerPriceUgx(15000, 16000)).toBe(15000);
    expect(offerPriceUgx(15000, 0)).toBe(15000);
    expect(offerPriceUgx(15000, Number.NaN)).toBe(15000);
  });
  it('the floor case: a campaign that takes nothing off leaves the regular price', () => {
    // At the 145,000 floor a 10% campaign takes nothing off (see the sale-only-when-price-drops rule).
    expect(offerPriceUgx(145000, 145000)).toBe(145000);
  });
});
