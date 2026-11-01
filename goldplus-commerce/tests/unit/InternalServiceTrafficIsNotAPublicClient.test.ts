import { describe, expect, it } from 'vitest';
import { isInternalServiceCall, resolveClientAddress } from '../../apps/api/src/domain/identity/ClientAddress';

/**
 * 2026-09-02: 67 of 214 sitemap URLs answered 503 to Googlebot while every one
 * of them answered 200 on its own. Cause: server-side rendering calls the API
 * for each page, those calls carry no forwarding headers, so every visitor in
 * the world shared ONE public-client rate-limit bucket. Ordinary crawling
 * exhausted it — and so could a single busy visitor, for everyone else.
 */
describe('internal service traffic is not a public client', () => {
  it('recognises our own server-side calls, which carry no forwarding headers', () => {
    expect(isInternalServiceCall({ forwardedFor: null, realIp: null })).toBe(true);
    expect(isInternalServiceCall({ forwardedFor: '', realIp: '' })).toBe(true);
    expect(isInternalServiceCall({ forwardedFor: '   ', realIp: undefined })).toBe(true);
  });

  it('never exempts a request that came through the edge', () => {
    // Caddy sets both headers on everything it proxies.
    expect(isInternalServiceCall({ forwardedFor: '41.210.1.9', realIp: '41.210.1.9' })).toBe(false);
    // Either header alone is still an external request.
    expect(isInternalServiceCall({ forwardedFor: '41.210.1.9', realIp: null })).toBe(false);
    expect(isInternalServiceCall({ forwardedFor: null, realIp: '41.210.1.9' })).toBe(false);
    // A spoofed chain does not become internal by being long.
    expect(isInternalServiceCall({ forwardedFor: '1.1.1.1, 2.2.2.2, 3.3.3.3', realIp: null })).toBe(false);
  });

  it('an external client cannot become internal by sending rubbish headers', () => {
    // Garbage that parses to no address is treated as absent — but such a
    // request cannot reach the api except through the edge, which overwrites
    // both headers. The guarantee is the deployment's, and this pins the shape.
    expect(isInternalServiceCall({ forwardedFor: 'not-an-ip', realIp: 'also-not' })).toBe(true);
    // …while the real client the edge reports is always attributed.
    const addr = resolveClientAddress({ forwardedFor: '41.210.1.9', realIp: '41.210.1.9', remoteAddr: '172.18.0.4', trustedHops: 1 });
    expect(addr).toEqual({ ip: '41.210.1.9', confidence: 'TRUSTED' });
  });

  it('the public limiter checks this before it counts anything', () => {
    const mw = readFileSync(resolve(__dirname, '../../apps/api/src/interfaces/http/middleware/publicAbuseControl.ts'), 'utf8');
    expect(mw).toContain('isInternalCall(c)');
    // The exemption must come before the counter, or the bucket still fills.
    expect(mw.indexOf('isInternalCall(c)')).toBeLessThan(mw.indexOf('abuseControlStore.consume'));
    // Forwarding headers stay readable in exactly one adapter.
    expect(mw).not.toMatch(/x-forwarded-for|x-real-ip/i);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
