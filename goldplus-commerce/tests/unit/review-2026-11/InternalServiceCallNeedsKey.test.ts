import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isInternalServiceRequest } from '../../../apps/api/src/interfaces/http/clientAddress';

const KEY = 'k'.repeat(40);
const bare = { forwardedFor: null, realIp: null };

describe('only our own service skips the public rate limit', () => {
  it('a header-less request without the internal key is a public client', () => {
    expect(isInternalServiceRequest({ ...bare, internalKey: undefined, expectedKey: KEY })).toBe(false);
    expect(isInternalServiceRequest({ ...bare, internalKey: 'wrong', expectedKey: KEY })).toBe(false);
  });
  it('the web container with the key and no forwarded client is internal', () => {
    expect(isInternalServiceRequest({ ...bare, internalKey: KEY, expectedKey: KEY })).toBe(true);
  });
  it('a forwarded visitor is never internal, key or not', () => {
    expect(isInternalServiceRequest({ forwardedFor: '203.0.113.7', realIp: null, internalKey: KEY, expectedKey: KEY })).toBe(false);
  });
  it('public web relays forward the visitor address', () => {
    for (const f of ['search/suggest.ts', 'saved.ts', 'assistant/rate.ts']) {
      const src = readFileSync(join(__dirname, '../../../apps/web/src/pages/api', f), 'utf8');
      expect(src, f).toMatch(/readClientAddress\(ctx\)/);
    }
  });
});
