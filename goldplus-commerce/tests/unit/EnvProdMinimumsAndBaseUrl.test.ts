import { describe, expect, it } from 'vitest';
import { configSchema, normalisePublicBaseUrl } from '../../apps/api/src/config/env';

const base = {
  databaseUrl: 'postgres://u:p@db:5432/g',
  publicApiBaseUrl: 'http://localhost:3000',
  metricsInternalUrl: 'http://sgtm:8080',
  jwtSecret: 'dev-secret', identityHashPepper: 'dev-pepper', mtnWebhookSecret: 'dev-mtn', airtelWebhookSecret: 'dev-airtel',
};

describe('env: production-only minimums and PUBLIC_API_BASE_URL', () => {
  it('development and staging accept short local secrets', () => {
    expect(configSchema.safeParse({ ...base, nodeEnv: 'development' }).success).toBe(true);
    expect(configSchema.safeParse({ ...base, nodeEnv: 'staging' }).success).toBe(true);
  });

  it('production still refuses them', () => {
    expect(configSchema.safeParse({ ...base, nodeEnv: 'production' }).success).toBe(false);
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
