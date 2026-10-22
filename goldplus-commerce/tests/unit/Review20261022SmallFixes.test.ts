import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { phoneDigitsE164 } from '../../apps/api/src/domain/advertising/ContactNormalisation';
import { normalisePhoneUg } from '../../apps/api/src/infrastructure/advertising/AdPlatforms';
import { classifyPublicEndpoint } from '../../apps/api/src/domain/security/PublicEndpointPolicy';
import { budgetedFormPath } from '../../apps/web/src/lib/publicFormLimiter';
import { planTermsImport } from '../../apps/api/src/domain/quotes/BulkTermsImport';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

/** Small confirmed defects from the 2026-10-22 review, one assertion each. */
describe('2026-10-22 review: small fixes', () => {
  it('"+256 0772…" (the national 0 after the country code) hashes as the same phone for ad matching', () => {
    expect(phoneDigitsE164('+256 0772123456')).toBe('256772123456');
    expect(normalisePhoneUg('+256 0772123456')).toBe('256772123456');
    expect(phoneDigitsE164('0772123456')).toBe('256772123456');
  });

  it('Google campaign and network keys survive into the order (sales by campaign / network)', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleOrderAttributionRepository.ts')).toMatch(/'gad_campaignid', 'gad_source', 'gp_net'/);
  });

  it('the dealer portal code is in the tight budget, like price access (it texts any number typed)', () => {
    expect(classifyPublicEndpoint('POST', '/quotes/dealer-portal/start')).toBe('auth-recovery');
    expect(classifyPublicEndpoint('POST', '/quotes/dealer-portal/verify')).toBe('auth-recovery');
    expect(budgetedFormPath('/dealers/dashboard')).not.toBeNull();
  });

  it('a comma-pasted dealer price with a thousands comma is refused, never read as UGX 21', () => {
    const plan = planTermsImport('GP-CA01, carton, 50, 21,000', [
      { productId: 'a', sku: 'GP-CA01', bulkUnit: 'carton', unitsPerCarton: null, dealerPriceUgx: null, retailPriceUgx: 30_000 },
    ]);
    expect(plan.changes).toEqual([]);
    expect(plan.problems).toHaveLength(1);
  });

  it('a pin is still taken for an order whose delivery failed (the redelivery needs it)', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleLocationPinRepository.ts')).toMatch(/'dispatched', 'delivery_failed'\]/);
  });

  it('no dispatch promise under an answer that says we cannot deliver', () => {
    expect(read('apps/api/src/interfaces/http/routes/delivery.ts')).toMatch(/promise: biz && \(outcome\.quote\.kind !== 'unavailable' \|\| hasFee\)/);
  });

  it('the admin product page reads the price and stock the /view endpoint actually returns', () => {
    const page = read('apps/web/src/pages/admin/products/[id].astro');
    expect(page).toMatch(/product\.retailPriceUgx/);
    expect(page).toMatch(/product\.availability\?\.kind/);
    expect(page).not.toMatch(/product\.stockStatus \|\| 'out_of_stock'/);
  });
});
