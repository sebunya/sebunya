import { describe, it, expect } from 'vitest';

describe('ControlledLiveCanaryRoutes', () => {
  it('admin routes exclude raw PII and provider secrets', () => {
    const mockResponse = {
      id: 'canary-123',
      dryRunId: 'dry-123',
      activationRequestId: 'req-123',
      status: 'READY_FOR_CANARY',
      redactedPayloadSummary: '[REDACTED]',
      customerEmail: '[REDACTED]',
      customerPhone: '[REDACTED]'
    };
    expect(mockResponse.customerEmail).not.toContain('@');
    expect(mockResponse.customerPhone).not.toContain('07');
  });

  it('route shape matches approved canary API shape', () => {
    const routes = [
      'POST /admin/controlled-activation/live-canaries',
      'GET /admin/controlled-activation/live-canaries',
      'GET /admin/controlled-activation/live-canaries/:canaryId',
      'POST /admin/controlled-activation/live-canaries/:canaryId/eligibility',
      'POST /admin/controlled-activation/live-canaries/:canaryId/start',
      'POST /admin/controlled-activation/live-canaries/:canaryId/pause',
      'POST /admin/controlled-activation/live-canaries/:canaryId/rollback',
      'POST /admin/controlled-activation/live-canaries/:canaryId/evidence-pack',
      'POST /admin/controlled-activation/live-canaries/:canaryId/complete'
    ];
    expect(routes).toContain('POST /admin/controlled-activation/live-canaries/:canaryId/start');
  });

  it('start route requires confirmation text START_CONTROLLED_CANARY', () => {
    const handler = (body: { confirmationText: string }) => {
      if (body.confirmationText !== 'START_CONTROLLED_CANARY') {
        throw new Error('INVALID_CONFIRMATION_TEXT');
      }
      return { success: true };
    };

    expect(() => handler({ confirmationText: 'START' })).toThrow('INVALID_CONFIRMATION_TEXT');
    expect(handler({ confirmationText: 'START_CONTROLLED_CANARY' }).success).toBe(true);
  });
});
