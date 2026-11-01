import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PESAPAL_CALLBACK_PATH,
  providerCallbackUrl,
} from '../../apps/api/src/application/use-cases/payments/StartPesaPalPaymentUseCase';

/**
 * PesaPal must return the customer to the API, which settles, and only then
 * sends them to the storefront.
 *
 * WHAT WAS WRONG
 * One variable, PESAPAL_CALLBACK_URL, served two different roles: what the
 * provider is told, and where the API sends the customer afterwards. Production
 * set it to the storefront page, so PesaPal delivered the paying customer
 * straight there with OrderTrackingId and OrderMerchantReference, while
 * callback.astro reads `status` and `reference`.
 *
 * Both were absent, so normalisePaymentReturnKind('') returned 'unknown_attempt'
 * and EVERY payment, including every successful one, rendered "We could not
 * confirm your payment. Please do not pay again until we have checked" with no
 * order number, leaving the basket cookie in place so the next checkout re-added
 * the items just paid for. The money did arrive, settled later by the IPN or the
 * ten-minute poller, which is why the shop was being paid while the customer was
 * being alarmed.
 *
 * Pointing the one variable at the API instead only moved the fault, because the
 * API's own redirect target read the same variable and it would redirect to
 * itself. There was no value that worked.
 */

describe('the provider is sent to the API, not the storefront', () => {
  it('derives the API route from the API origin when nothing is set', () => {
    expect(providerCallbackUrl({ PUBLIC_API_BASE_URL: 'https://api.shopgoldplus.com' } as never))
      .toBe('https://api.shopgoldplus.com/commerce/payments/pesapal/callback');
  });

  it('needs no new environment variable to be correct in production', () => {
    // The real production values: the storefront callback is set, the provider
    // one is not. The derived value must still be the API route.
    const url = providerCallbackUrl({
      PUBLIC_API_BASE_URL: 'https://api.shopgoldplus.com',
      PESAPAL_CALLBACK_URL: 'https://shopgoldplus.com/checkout/pesapal/callback',
    } as never);
    expect(url).toBe('https://api.shopgoldplus.com/commerce/payments/pesapal/callback');
    expect(url).not.toContain('/checkout/');
  });

  it('tolerates a trailing slash on the origin', () => {
    expect(providerCallbackUrl({ PUBLIC_API_BASE_URL: 'https://api.shopgoldplus.com/' } as never))
      .toBe('https://api.shopgoldplus.com/commerce/payments/pesapal/callback');
  });

  it('lets an explicit value win', () => {
    expect(providerCallbackUrl({
      PESAPAL_PROVIDER_CALLBACK_URL: 'https://api.example/x',
      PUBLIC_API_BASE_URL: 'https://api.shopgoldplus.com',
    } as never)).toBe('https://api.example/x');
  });

  it('points at the route that actually settles', () => {
    const routes = readFileSync(
      resolve(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'),
      'utf8',
    );
    expect(routes).toContain(`routes.get('${PESAPAL_CALLBACK_PATH.replace('/commerce', '')}'`);
    const handler = routes.slice(routes.indexOf("routes.get('/payments/pesapal/callback'"));
    // It reads the parameter names PesaPal actually sends, and it settles.
    expect(handler).toMatch(/OrderTrackingId/);
    expect(handler).toMatch(/OrderMerchantReference/);
    expect(handler).toMatch(/settlePaymentUseCase\.execute/);
  });
});

describe('the two destinations never collapse back into one', () => {
  const src = readFileSync(
    resolve(__dirname, '../../apps/api/src/application/use-cases/payments/StartPesaPalPaymentUseCase.ts'),
    'utf8',
  );

  it('the provider callback is not read from the storefront variable', () => {
    const body = src.slice(src.indexOf('async execute('));
    expect(body).not.toMatch(/PESAPAL_CALLBACK_URL/);
    expect(body).toMatch(/const callbackUrl = providerCallbackUrl\(\);/);
  });

  it('the storefront page remains the API redirect target', () => {
    const routes = readFileSync(
      resolve(__dirname, '../../apps/api/src/interfaces/http/routes/commerce.ts'),
      'utf8',
    );
    expect(routes).toMatch(/const frontendCallbackUrl = process\.env\.PESAPAL_CALLBACK_URL/);
  });

  it('the storefront page reads what the API sends it', () => {
    const page = readFileSync(
      resolve(__dirname, '../../apps/web/src/pages/checkout/pesapal/callback.astro'),
      'utf8',
    );
    expect(page).toMatch(/searchParams\.get\('reference'\)/);
    expect(page).toMatch(/searchParams\.get\('status'\)/);
  });
});
