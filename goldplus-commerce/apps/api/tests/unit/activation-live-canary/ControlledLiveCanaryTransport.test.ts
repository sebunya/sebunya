import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DefaultControlledLiveCanaryTransport } from '../../../src/infrastructure/activation/DefaultControlledLiveCanaryTransport.js';

describe('ControlledLiveCanaryTransport - PostHog Smoke', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      json: async () => ({ status: 1 })
    })));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('PostHog transport returns NOT_CONFIGURED when host env is missing', async () => {
    process.env.POSTHOG_HOST = '';
    process.env.POSTHOG_PROJECT_API_KEY = 'test-key';
    const transport = new DefaultControlledLiveCanaryTransport();
    const result = await transport.sendCanary('canary-1', 'posthog', [{}], 1);
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.redactedResponseSummary).toContain('missing POSTHOG_HOST or POSTHOG_PROJECT_API_KEY');
  });

  it('PostHog transport returns NOT_CONFIGURED when project key env is missing', async () => {
    process.env.POSTHOG_HOST = 'test.posthog.com';
    process.env.POSTHOG_PROJECT_API_KEY = '';
    const transport = new DefaultControlledLiveCanaryTransport();
    const result = await transport.sendCanary('canary-1', 'posthog', [{}], 1);
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.redactedResponseSummary).toContain('missing POSTHOG_HOST or POSTHOG_PROJECT_API_KEY');
  });


  it('PostHog transport blocks if destination allowlist is not exactly ["posthog"]', async () => {
    process.env.POSTHOG_HOST = 'test.posthog.com';
    process.env.POSTHOG_PROJECT_API_KEY = 'test-key';
    const transport = new DefaultControlledLiveCanaryTransport();
    const result = await transport.sendCanary('canary-1', 'meta', [{}], 1);
    expect(result.status).toBe('FAILED');
    expect(result.redactedResponseSummary).toContain('destination allowlist mismatch');
  });

  it('PostHog transport blocks if canary cap is not exactly 1', async () => {
    process.env.POSTHOG_HOST = 'test.posthog.com';
    process.env.POSTHOG_PROJECT_API_KEY = 'test-key';
    const transport = new DefaultControlledLiveCanaryTransport();
    const result = await transport.sendCanary('canary-1', 'posthog', [{}], 5);
    expect(result.status).toBe('FAILED');
    expect(result.redactedResponseSummary).toContain('canary cap mismatch');
  });

  it('PostHog transport blocks if payload count is not exactly 1', async () => {
    process.env.POSTHOG_HOST = 'test.posthog.com';
    process.env.POSTHOG_PROJECT_API_KEY = 'test-key';
    const transport = new DefaultControlledLiveCanaryTransport();
    const result = await transport.sendCanary('canary-1', 'posthog', [{}, {}], 1);
    expect(result.status).toBe('FAILED');
    expect(result.redactedResponseSummary).toContain('event count mismatch');
  });

  it('PostHog transport blocks if raw email is present', async () => {
    process.env.POSTHOG_HOST = 'test.posthog.com';
    process.env.POSTHOG_PROJECT_API_KEY = 'test-key';
    const transport = new DefaultControlledLiveCanaryTransport();
    const result = await transport.sendCanary('canary-1', 'posthog', [{ email: 'admin@goldplus.co' }], 1);
    expect(result.status).toBe('FAILED');
    expect(result.redactedResponseSummary).toContain('raw PII or secret keywords detected');
  });

  it('PostHog transport blocks if raw phone is present', async () => {
    process.env.POSTHOG_HOST = 'test.posthog.com';
    process.env.POSTHOG_PROJECT_API_KEY = 'test-key';
    const transport = new DefaultControlledLiveCanaryTransport();
    const result = await transport.sendCanary('canary-1', 'posthog', [{ phone: '0788000000' }], 1);
    expect(result.status).toBe('FAILED');
    expect(result.redactedResponseSummary).toContain('raw PII or secret keywords detected');
  });

  it('PostHog transport blocks if payment token is present', async () => {
    process.env.POSTHOG_HOST = 'test.posthog.com';
    process.env.POSTHOG_PROJECT_API_KEY = 'test-key';
    const transport = new DefaultControlledLiveCanaryTransport();
    const result = await transport.sendCanary('canary-1', 'posthog', [{ payment_token: 'xyz123' }], 1);
    expect(result.status).toBe('FAILED');
    expect(result.redactedResponseSummary).toContain('raw PII or secret keywords detected');
  });

  it('PostHog transport sends exactly one request when config and safeguards pass', async () => {
    process.env.POSTHOG_HOST = 'test.posthog.com';
    process.env.POSTHOG_PROJECT_API_KEY = 'test-key';
    const transport = new DefaultControlledLiveCanaryTransport();
    const result = await transport.sendCanary('canary-1', 'posthog', [{ safe: true }], 1);
    
    expect(result.status).toBe('ACCEPTED');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe('https://test.posthog.com/capture/');
    
    const body = JSON.parse(options.body);
    expect(body.event).toBe('goldplus_controlled_live_canary_smoke');
    expect(body.api_key).toBe('test-key');
    expect(body.properties.canary).toBe(true);
    expect(body.properties.canary_cap).toBe(1);
    expect(body.properties.contains_no_raw_pii).toBe(true);
    expect(body.properties.email).toBeUndefined();
    expect(body.properties.phone).toBeUndefined();
  });
});
