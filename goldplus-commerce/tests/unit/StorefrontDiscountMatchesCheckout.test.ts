import { describe, expect, it } from 'vitest';
import { resolveStorefrontDiscount, storefrontPricingView } from '../../apps/api/src/application/pricing/StorefrontDiscountQuery';

/**
 * Checkout drops a promotion whose usage limit is used up, and needs a code for one with batch codes; the storefront
 * resolver checked neither, so the site, JSON-LD and the Merchant/Meta feeds kept advertising a sale price the basket
 * no longer charged (2026-10-22 review). The storefront now reads through the same two gates.
 */
const now = new Date('2026-10-22T10:00:00Z');
const siteWide = {
  definition: { id: 'def-1', key: 'launch', name: 'Launch 10%' },
  version: {
    id: 'ver-1', conditions: [], exclusions: [], couponCode: null, priceFloorUgx: 0,
    schedule: { startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-11-01T00:00:00Z') },
    benefits: [{ type: 'PERCENTAGE_OFF', value: 1000, maximumDiscountUgx: null, targetProductIds: [] }],
  },
};
const pricing = { listActiveVersions: async () => [siteWide] } as never;
const view = (exhausted: string[], gated: string[]) => storefrontPricingView(
  pricing,
  { exhaustedVersionIds: async () => new Set(exhausted) },
  { definitionsWithActiveCodes: async () => new Set(gated) },
);

describe('the storefront advertises only what checkout charges', () => {
  it('an open site-wide sale is advertised', async () => {
    expect((await resolveStorefrontDiscount(view([], []), now)).active).toBe(true);
  });
  it('not once its usage limit is used up', async () => {
    expect((await resolveStorefrontDiscount(view(['ver-1'], []), now)).active).toBe(false);
  });
  it('not when the promotion needs a batch code', async () => {
    expect((await resolveStorefrontDiscount(view([], ['def-1']), now)).active).toBe(false);
  });
});
