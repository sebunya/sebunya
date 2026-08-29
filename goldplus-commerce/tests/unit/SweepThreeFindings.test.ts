import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { salePriceUgx, campaignSaves } from '@goldplus/shared';

/**
 * The 2026-08-29 sweep of the nine subsystems the earlier audits only ever
 * checked mechanically. One assertion per fix, so a regression names the
 * finding it reopened.
 */
const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('nobody acts as somebody else', () => {
  it('a request body cannot override the session identity', () => {
    const src = read('apps/api/src/interfaces/http/routes/account.ts');
    expect(src).toMatch(/\.\.\.body,\s*\n\s*userId,/);
    expect(src).not.toMatch(/userId,\s*\n\s*\.\.\.body,/);
  });

  it('consent is recorded against the session, never a body field', () => {
    const src = read('apps/api/src/interfaces/http/routes/consent.ts');
    expect(src).toMatch(/optionalCustomerSessionMiddleware/);
    expect(src.match(/user_id: c\.get\('userId'\)/g)?.length).toBe(2);
  });

  it('one account cannot read another account consent state', () => {
    expect(read('apps/api/src/interfaces/http/routes/consent.ts'))
      .toMatch(/if \(requestedUserId && requestedUserId !== sessionUserId\)/);
  });

  it('an order marketing journey needs a permission', () => {
    expect(read('apps/api/src/interfaces/http/routes/measurement.ts'))
      .toMatch(/'\/attribution\/:orderId', authMiddleware, requirePermissions/);
  });

  it('an unauthenticated caller is not shown the raw error', () => {
    expect(read('apps/api/src/interfaces/http/routes/governance.ts')).toMatch(/err instanceof DealerApplicationValidationError/);
    expect(read('apps/api/src/interfaces/http/routes/seo.ts')).toMatch(/message: 'Robots configuration is unavailable\.'/);
  });

  it('a present but dead token is rejected, not downgraded to anonymous', () => {
    const src = read('apps/api/src/interfaces/http/middleware/customerSession.ts');
    const opt = src.slice(src.indexOf('optionalCustomerSessionMiddleware'));
    expect(opt).toMatch(/if \(!session\.ok\)/);
  });
});

describe('a price is the price', () => {
  it('the formula has ONE home, and the web lib re-exports it', () => {
    // From the pricing SUBPATH. The package barrel reaches node:crypto via
    // checkout-intent, and this module is bundled for the browser by the
    // recently-viewed rail, so importing the barrel breaks the client build.
    expect(read('apps/web/src/lib/storefrontDiscount.ts')).toMatch(/export \{ salePriceUgx \} from '@goldplus\/shared\/pricing'/);
    expect(JSON.parse(read('packages/shared/package.json')).exports['./pricing']).toBeTruthy();
  });

  it('the floor stops the cut', () => {
    // 155,000 less 10% would be 139,500, but the floor stops it at 145,000,
    // which is still a real 10,000 saving.
    expect(salePriceUgx(155_000, 1000, 145_000)).toBe(145_000);
    expect(campaignSaves(155_000, 1000, 145_000)).toBe(true);
    // Already at the floor: the campaign takes off nothing, so it is no sale.
    expect(salePriceUgx(145_000, 1000, 145_000)).toBe(145_000);
    expect(campaignSaves(145_000, 1000, 145_000)).toBe(false);
  });

  it('a recommendation card claims a discount only when the price drops', () => {
    expect(read('apps/web/src/components/recommendations/RecommendationCard.astro'))
      .toMatch(/const onSale = candidateSaleUgx !== null && candidateSaleUgx < item\.price!/);
  });

  it('the nav says "up to", because the floor stops some products dropping', () => {
    const src = read('apps/web/src/components/GpNav.astro');
    expect(src).not.toMatch(/discount on everything/);
    expect(src).toMatch(/Up to <em>−\{navDeal\.percent\}%<\/em> in the shop/);
  });

  it('the homepage spots quote the campaign price like every other card', () => {
    expect(read('apps/web/src/components/HomeCommerceHighlights.astro')).toMatch(/function chargedPrice/);
  });

  it('the Merchant Center feed publishes the price we charge', () => {
    expect(read('apps/api/src/application/use-cases/seo-growth/MerchantFeedUseCase.ts')).toMatch(/g:sale_price/);
  });

  it('points are previewed on the total the customer actually pays', () => {
    expect(read('apps/web/src/pages/cart.astro')).toMatch(/Math\.floor\(saleSubtotal \/ 1000\) \* cartLoyaltyRate/);
    expect(read('apps/web/src/pages/products/[slug].astro')).toMatch(/pdpSaleUgx \?\? product\.retailPriceUgx/);
  });

  it('a product cannot be saved below the owner floor', () => {
    const src = read('apps/api/src/interfaces/http/routes/admin/products.ts');
    expect(src.match(/if \(priceUgx < STOREFRONT_PRICE_FLOOR_UGX\)/g)?.length).toBe(2);
  });
});

describe('points and cards survive a failure', () => {
  it('a spent scratch card stays spent', () => {
    const src = read('apps/api/src/application/use-cases/loyalty/LoyaltyDrawUseCases.ts');
    expect(src).toMatch(/if \(!awarded\) await this\.draws\.releaseToken/);
    expect(src).toMatch(/awarded = true;/);
  });

  it('a second partial refund claws back its own share', () => {
    const src = read('apps/api/src/application/use-cases/loyalty/LoyaltyCompletionUseCases.ts');
    expect(src).toMatch(/idempotencyKey: `reversal:\$\{earn\.id\}:\$\{cumulative\}`/);
    expect(src).not.toMatch(/idempotencyKey: `reversal:\$\{earn\.id\}`/);
  });

  it('capacity is enforced where the reservation is written', () => {
    expect(read('apps/api/src/application/use-cases/loyalty/LoyaltyCompletionUseCases.ts'))
      .toMatch(/maxTotalReservedPoints: balance\.available/);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyCompletionRepository.ts'))
      .toMatch(/from loyalty_accounts where id = \$\{input\.accountId\} for update/);
  });

  it('a suppressed expiry warning is retried, not counted as sent', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleLoyaltyCompletionRepository.ts'))
      .toMatch(/eq\(loyaltyExpiryNotices\.channel, 'notification'\)/);
  });
});

describe('a job runs once, and keeps running', () => {
  it('a telemetry event is claimed before it is sent', () => {
    const src = read('apps/api/src/infrastructure/telemetry/TelemetryDispatchService.ts');
    expect(src).toMatch(/export const CLAIM_LEASE_MS/);
    expect(src).toMatch(/\.set\(\{ status: 'processing', nextAttemptAt: new Date\(now\.getTime\(\) \+ CLAIM_LEASE_MS\) \}\)/);
  });

  it('the queue worker takes the same claim', () => {
    const src = read('apps/api/src/infrastructure/queues/QueueWorkers.ts');
    expect(src).toMatch(/status: 'processing', nextAttemptAt: new Date\(claimNow\.getTime\(\) \+ CLAIM_LEASE_MS\)/);
    expect(src).toMatch(/nextAttemptAt: new Date\(Date\.now\(\) \+ TELEMETRY_RETRY_DELAY_MS\)/);
  });

  it('a provider error is retried rather than parked for ever', () => {
    expect(read('apps/api/src/application/use-cases/seo-growth/IntegrationScheduleReconciler.ts'))
      .toMatch(/'RATE_LIMITED', 'PROVIDER_ERROR',/);
  });

  it('an abandoned sync job stops blocking its connection', () => {
    const src = read('apps/api/src/infrastructure/seo/IntegrationScheduleRunner.ts');
    expect(src).toMatch(/STALE_RUNNING_JOB_MS/);
    expect(src).toMatch(/const liveRunning = running\.length - staleRunning\.length;/);
  });

  it('one bad row does not abort the hourly rebuild', () => {
    const src = read('apps/api/src/infrastructure/scheduler/RecommendationMaterializer.ts');
    expect(src.match(/\[RecommendationMaterializer\] (Category|Product) skipped/g)?.length).toBe(2);
  });
});

describe('what the admin sees is what the shop has', () => {
  it('a product page reached by id resolves the slug it needs', () => {
    expect(read('apps/web/src/pages/admin/products/[id].astro')).toMatch(/async function resolveSlug/);
    expect(read('apps/web/src/pages/admin/products/[id]/edit.astro')).toMatch(/const productSlug = adminProductRes\.data\?\.slug \?\? '';/);
  });

  it('saving properties cannot silently recategorise a product', () => {
    const src = read('apps/web/src/pages/admin/products/[id]/edit-properties.astro');
    expect(src).not.toMatch(/\|\| categories\[0\]/);
    expect(src).toMatch(/\{!productCategoryId && \(/);
  });

  it('the networks are spelled the way they spell themselves', () => {
    expect(read('packages/shared/src/business/index.ts')).toMatch(/youtube: 'YouTube'/);
    expect(read('apps/web/src/pages/admin/business-info.astro')).toMatch(/label: BUSINESS_SOCIAL_LABELS\[key\]/);
  });

  it('every admin timestamp is Kampala time', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.astro')) {
          for (const call of readFileSync(p, 'utf8').match(/toLocale(String|DateString|TimeString)\([^)]*\)/g) ?? []) {
            if (!call.includes('Africa/Kampala')) offenders.push(`${entry.name}: ${call}`);
          }
        }
      }
    };
    walk(resolve(ROOT, 'apps/web/src/pages/admin'));
    expect(offenders).toEqual([]);
  });
});

describe('consent is read for the right person', () => {
  it('the paid-social lookup passes its identifiers in the declared order', () => {
    expect(read('apps/api/src/application/use-cases/measurement/RoutePaidSocialEventUseCase.ts'))
      .toMatch(/getCurrentState\(sessionId, userId\)/);
  });
});
