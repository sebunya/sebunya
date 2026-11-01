import { describe, it, expect } from 'vitest';
import { configSchema, redactedConfig } from '../../apps/api/src/config/env';

const valid = {
  nodeEnv: 'production',
  databaseUrl: 'postgres://user:pw@db:5432/goldplus',
  jwtSecret: 'x'.repeat(32),
  publicApiBaseUrl: 'https://api.goldplus.example',
  mtnWebhookSecret: 'm'.repeat(24),
  airtelWebhookSecret: 'a'.repeat(24),
  identityHashPepper: 'p'.repeat(32),
  metricsInternalUrl: 'http://sgtm:8080',
  measurement: { dryRun: true, liveDestinationsEnabled: false, paidSocialQueueEnabled: false, qaAllowNetwork: false },
};

describe('configSchema — the validated configuration boundary', () => {
  it('accepts a well-formed config', () => {
    expect(configSchema.parse(valid)).toMatchObject({ jwtSecret: valid.jwtSecret });
  });

  it('rejects a short JWT secret and pepper', () => {
    expect(() => configSchema.parse({ ...valid, jwtSecret: 'too-short' })).toThrow();
    expect(() => configSchema.parse({ ...valid, identityHashPepper: 'short' })).toThrow();
  });

  it('rejects webhook secrets below the minimum length', () => {
    expect(() => configSchema.parse({ ...valid, mtnWebhookSecret: 'short' })).toThrow();
  });

  it('rejects a non-URL public base', () => {
    expect(() => configSchema.parse({ ...valid, publicApiBaseUrl: 'not-a-url' })).toThrow();
  });

  it('requires a fully-typed measurement block when present', () => {
    expect(() => configSchema.parse({ ...valid, measurement: { dryRun: true } })).toThrow();
  });
});

describe('redactedConfig — safe diagnostics', () => {
  it('masks every secret as set(<len>) and never leaks the value', () => {
    const r = redactedConfig(valid as any);
    expect(r.jwtSecret).toBe('set(32)');
    expect(r.identityHashPepper).toBe('set(32)');
    expect(r.mtnWebhookSecret).toBe('set(24)');
    // The DB URL carries the password, so it is a secret too.
    expect(r.databaseUrl).toBe(`set(${valid.databaseUrl.length})`);
    const serialised = JSON.stringify(r);
    expect(serialised).not.toContain(valid.jwtSecret);
    expect(serialised).not.toContain('pw@db'); // no DB password
  });

  it('shows non-secret values in the clear and marks unset secrets', () => {
    const r = redactedConfig({ ...valid, jwtSecret: '' } as any);
    expect(r.nodeEnv).toBe('production');
    expect(r.publicApiBaseUrl).toBe(valid.publicApiBaseUrl);
    expect(r.jwtSecret).toBe('unset');
  });
});
