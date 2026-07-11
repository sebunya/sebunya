import { describe, it, expect } from 'vitest';
import { DefaultControlledLiveCanaryTransport } from '../../../src/infrastructure/activation/DefaultControlledLiveCanaryTransport.js';

describe('ControlledLiveCanaryTransport', () => {
  it('transport returns NOT_CONFIGURED when safe transport does not exist', async () => {
    const transport = new DefaultControlledLiveCanaryTransport();
    const result = await transport.sendCanary('canary-123', 'meta', [], 10);
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.redactedResponseSummary).toContain('provider transport integration required before real live canary send');
  });

  it('transport does not log raw PII or expose secrets', async () => {
    const transport = new DefaultControlledLiveCanaryTransport();
    const rawPayloads = [{ email: 'sensitive@example.com', secret: 'abc123secret' }];
    const result = await transport.sendCanary('canary-123', 'meta', rawPayloads, 10);
    expect(result.redactedPayloadSummary).not.toContain('sensitive@example.com');
    expect(result.redactedPayloadSummary).not.toContain('abc123secret');
  });
});
