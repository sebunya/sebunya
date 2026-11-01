import { describe, expect, it } from 'vitest';
import { configSchema, normalisePublicBaseUrl } from '../../apps/api/src/config/env';

describe('env: production-only minimums and PUBLIC_API_BASE_URL', () => {
  it('the schema does not impose production secret lengths on every environment', () => {
    const shape = configSchema.shape;
    for (const k of ['jwtSecret', 'identityHashPepper', 'mtnWebhookSecret', 'airtelWebhookSecret'] as const) {
      expect(shape[k].safeParse('short-dev-secret').success, k).toBe(true);
    }
  });

  it('a base URL without a scheme is read as https', () => {
    expect(normalisePublicBaseUrl('api.goldplus.ug')).toBe('https://api.goldplus.ug');
    expect(normalisePublicBaseUrl(' https://api.goldplus.ug ')).toBe('https://api.goldplus.ug');
    expect(normalisePublicBaseUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('a value that cannot be a URL is refused (boot names it)', () => {
    expect(normalisePublicBaseUrl('ftp://x.y')).toBeNull();
    expect(normalisePublicBaseUrl('not a url')).toBeNull();
    expect(normalisePublicBaseUrl('')).toBeNull();
  });
});
