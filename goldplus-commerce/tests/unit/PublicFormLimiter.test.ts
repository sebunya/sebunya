import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PublicFormLimiter,
  budgetedFormPath,
  tooManySubmissionsResponse,
  visitorKey,
} from '../../apps/web/src/lib/publicFormLimiter';

/**
 * The storefront posts its public forms to the API server side, so the API's
 * per-visitor budgets saw "our own service" and skipped them: a script could
 * post /dealers/apply as fast as it liked, and each post texted the phone typed
 * on it. The web middleware now applies a per-visitor budget itself.
 */
describe('PublicFormLimiter', () => {
  it('allows a visitor their budget, then refuses, then allows again once the window passes', () => {
    const limiter = new PublicFormLimiter({ '/dealers/apply': { limit: 3, windowMs: 60_000 } });
    const t0 = 1_000_000;
    expect([0, 1, 2].map((i) => limiter.allow('/dealers/apply', '1.2.3.4', t0 + i))).toEqual([true, true, true]);
    expect(limiter.allow('/dealers/apply', '1.2.3.4', t0 + 10)).toBe(false);
    expect(limiter.allow('/dealers/apply', '5.6.7.8', t0 + 10)).toBe(true); // another visitor is unaffected
    expect(limiter.allow('/dealers/apply', '1.2.3.4', t0 + 60_001)).toBe(true);
  });

  it('leaves paths without a budget alone', () => {
    const limiter = new PublicFormLimiter({ '/dealers/apply': { limit: 0, windowMs: 60_000 } });
    expect(limiter.allow('/checkout', 'x')).toBe(true);
  });

  it('never remembers more visitors than its ceiling', () => {
    const limiter = new PublicFormLimiter({ '/f': { limit: 1, windowMs: 60_000 } }, 2);
    limiter.allow('/f', 'a', 1);
    limiter.allow('/f', 'b', 2);
    limiter.allow('/f', 'c', 3); // evicts 'a'
    expect(limiter.allow('/f', 'a', 4)).toBe(true);
  });
});

describe('budgetedFormPath', () => {
  it('covers the SMS-sending forms and the order lookup, however the path is spelled', () => {
    expect(budgetedFormPath('/dealers/apply')).toBe('/dealers/apply');
    expect(budgetedFormPath('/Dealers/Apply/')).toBe('/dealers/apply');
    expect(budgetedFormPath('/support/fake')).toBe('/support/fake');
    expect(budgetedFormPath('/support/issue')).toBe('/support/issue');
    expect(budgetedFormPath('/quote-request')).toBe('/quote-request');
    expect(budgetedFormPath('/track-order')).toBe('/track-order');
    expect(budgetedFormPath('/checkout')).toBeNull();
    expect(budgetedFormPath('/login')).toBeNull();
  });
});

describe('visitorKey', () => {
  it('prefers the client Caddy resolved (X-Real-IP), then Astro, and never throws', () => {
    expect(visitorKey(new Headers({ 'x-real-ip': '41.210.1.2' }), () => '172.18.0.5')).toBe('41.210.1.2');
    expect(visitorKey(new Headers(), () => '41.210.1.3')).toBe('41.210.1.3');
    expect(visitorKey(new Headers({ 'x-real-ip': '  ' }), () => '41.210.1.4')).toBe('41.210.1.4');
    expect(visitorKey(new Headers(), () => { throw new Error('prerendered'); })).toBe('unknown');
  });

  it('never trusts a raw CF-Connecting-IP: a caller reaching the origin could rotate it per POST', () => {
    // Caddy only honours CF-Connecting-IP from Cloudflare's ranges when it
    // computes {client_ip} (sent as X-Real-IP); the header itself is forwarded
    // untouched, so reading it directly would let the budget be sidestepped.
    expect(visitorKey(new Headers({ 'cf-connecting-ip': '1.2.3.4', 'x-real-ip': '41.210.1.2' }), () => '172.18.0.5')).toBe('41.210.1.2');
    expect(visitorKey(new Headers({ 'cf-connecting-ip': '1.2.3.4' }), () => '172.18.0.5')).toBe('172.18.0.5');
  });
});

describe('the refusal and the wiring', () => {
  it('is a 429 that says what to do, and is never cached', async () => {
    const res = tooManySubmissionsResponse();
    expect(res.status).toBe(429);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toMatch(/wait a few minutes/i);
  });

  it('is applied by the web middleware to POSTs', () => {
    const src = readFileSync(resolve(__dirname, '../../apps/web/src/middleware.ts'), 'utf8');
    expect(src).toMatch(/publicFormLimiter\.allow\(/);
    expect(src).toMatch(/method === 'POST'/);
  });
});
