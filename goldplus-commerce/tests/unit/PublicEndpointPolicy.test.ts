import { describe, it, expect } from 'vitest';
import {
  classifyPublicEndpoint,
  publicEndpointPolicy,
  allPublicEndpointPolicies,
  normalisePath,
  type RouteFamily,
} from '../../apps/api/src/domain/security/PublicEndpointPolicy';

describe('classifyPublicEndpoint — stable, bounded route families', () => {
  it('maps each declared public endpoint to its family', () => {
    expect(classifyPublicEndpoint('POST', '/auth/login')).toBe('auth-customer-login');
    expect(classifyPublicEndpoint('POST', '/auth/admin/login')).toBe('auth-admin-login');
    // Account recovery sends an SMS or an email per request and completing it
    // is a code-guessing surface: never the 1,000 a minute global budget.
    expect(classifyPublicEndpoint('POST', '/auth/password/forgot')).toBe('auth-recovery');
    expect(classifyPublicEndpoint('POST', '/auth/password/forgot-sms')).toBe('auth-recovery');
    expect(classifyPublicEndpoint('POST', '/auth/password/reset')).toBe('auth-recovery');
    expect(classifyPublicEndpoint('POST', '/auth/password/reset-sms')).toBe('auth-recovery');
    expect(classifyPublicEndpoint('POST', '/governance/dealers/apply')).toBe('dealer-application');
    expect(classifyPublicEndpoint('POST', '/governance/quotes/request')).toBe('quote-request');
    expect(classifyPublicEndpoint('POST', '/governance/support/report-issue')).toBe('issue-report');
    expect(classifyPublicEndpoint('POST', '/governance/support/report-fake')).toBe('fake-product-report');
    expect(classifyPublicEndpoint('POST', '/governance/verification/check')).toBe('verification');
    expect(classifyPublicEndpoint('POST', '/consent/signal')).toBe('consent-mutation');
    expect(classifyPublicEndpoint('POST', '/consent/withdraw')).toBe('consent-mutation');
    expect(classifyPublicEndpoint('GET', '/account/orders')).toBe('order-lookup');
    expect(classifyPublicEndpoint('GET', '/account/orders/abc-123')).toBe('order-lookup');
    expect(classifyPublicEndpoint('POST', '/account/surveys/s-1/start')).toBe('surveys');
    expect(classifyPublicEndpoint('POST', '/product-finder/sessions')).toBe('product-finder');
    expect(classifyPublicEndpoint('POST', '/telemetry/collect')).toBe('telemetry');
    expect(classifyPublicEndpoint('POST', '/telemetry/collect/batch')).toBe('telemetry');
    expect(classifyPublicEndpoint('POST', '/webhooks/payment/mtn')).toBe('payment-webhook');
    expect(classifyPublicEndpoint('POST', '/commerce/cart')).toBe('cart');
    expect(classifyPublicEndpoint('POST', '/commerce/cart/items')).toBe('cart');
  });

  it('collapses attacker path variation for one family into ONE key', () => {
    // The core defect: a per-path key made "1000/min global" mean 1000/min per
    // invented URL. Every one of these must resolve to the SAME family so they
    // share a single budget.
    const variants = [
      '/account/orders/1',
      '/account/orders/2',
      '/account/orders/99999',
      '/account/orders/../orders/7',
      '/account/orders/7?ts=1',
      '/account/orders/7?ts=2',
      '/ACCOUNT/Orders/7',
      '/account//orders//7',
      '/account/orders/7/',
    ];
    const families = new Set(variants.map((p) => classifyPublicEndpoint('GET', p)));
    expect(families).toEqual(new Set<RouteFamily>(['order-lookup']));
  });

  it('sends everything uncategorised to ONE shared global family, not one per URL', () => {
    const invented = Array.from({ length: 500 }, (_, i) => `/x/${i}/${i * 7}?q=${i}`);
    const families = new Set(invented.map((p) => classifyPublicEndpoint('GET', p)));
    expect(families).toEqual(new Set<RouteFamily>(['global']));
    // The whole point: unbounded distinct paths, exactly one counter.
    expect(families.size).toBe(1);
  });

  it('classifies provider webhooks regardless of method so a retry cannot leak to global', () => {
    for (const method of ['POST', 'GET', 'PUT', 'HEAD']) {
      expect(classifyPublicEndpoint(method, '/webhooks/payment/airtel')).toBe('payment-webhook');
    }
  });

  it('does not mistake a longer path for the exact login endpoint', () => {
    // /auth/login is an exact match; /auth/login-history is not login.
    expect(classifyPublicEndpoint('POST', '/auth/login-history')).toBe('global');
    expect(classifyPublicEndpoint('GET', '/auth/login')).toBe('global'); // wrong method → not the login family
  });

  it('is total: every input returns a member of the closed family set', () => {
    const known = new Set(allPublicEndpointPolicies().map((p) => p.family));
    for (const p of ['/', '', '/a', '/webhooks', '/governance', '/account', '/consent/x/y/z']) {
      expect(known.has(classifyPublicEndpoint('POST', p))).toBe(true);
    }
  });
});

describe('publicEndpointPolicy — per-family risk posture', () => {
  it('gives credential surfaces a tight budget and human forms a low ceiling', () => {
    expect(publicEndpointPolicy('auth-customer-login').limit).toBeLessThanOrEqual(10);
    expect(publicEndpointPolicy('auth-admin-login').limit).toBeLessThanOrEqual(10);
    expect(publicEndpointPolicy('auth-recovery').limit).toBeLessThanOrEqual(5);
    expect(publicEndpointPolicy('auth-recovery').outage).toBe('STRICT');
    expect(publicEndpointPolicy('dealer-application').limit).toBeLessThanOrEqual(5);
  });

  it('degrades human forms STRICT and provider webhooks GENEROUS on Redis outage', () => {
    expect(publicEndpointPolicy('dealer-application').outage).toBe('STRICT');
    expect(publicEndpointPolicy('auth-customer-login').outage).toBe('STRICT');
    // A dropped payment confirmation is worse than the configured rate per
    // replica, so the HMAC-authenticated webhook keeps its full local budget.
    expect(publicEndpointPolicy('payment-webhook').outage).toBe('GENEROUS');
    expect(publicEndpointPolicy('payment-webhook').class).toBe('PROVIDER_WEBHOOK');
  });

  it('keeps telemetry on the per-second window it had before', () => {
    expect(publicEndpointPolicy('telemetry').windowMs).toBe(1_000);
    expect(publicEndpointPolicy('telemetry').limit).toBe(100);
  });

  it('every family has a positive limit and window', () => {
    for (const p of allPublicEndpointPolicies()) {
      expect(p.limit).toBeGreaterThan(0);
      expect(p.windowMs).toBeGreaterThan(0);
    }
  });
});

describe('normalisePath', () => {
  it('lowercases, strips query/fragment, collapses slashes, trims trailing slash', () => {
    expect(normalisePath('/Auth/Login/')).toBe('/auth/login');
    expect(normalisePath('/account//orders//7?x=1#f')).toBe('/account/orders/7');
    expect(normalisePath('/')).toBe('/');
    expect(normalisePath('')).toBe('/');
  });
});
