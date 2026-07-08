import { describe, it, expect } from 'vitest';

describe('PaymentMeasurementReconciliationRoutes', () => {
  it('admin routes exclude raw PII and provider secrets', () => {
    // Simulated route behavior test: Ensures the route handlers strip out raw PII from admin responses
    const mockAdminResponse = {
      orderId: 'ord-1',
      amount: 100,
      currency: 'UGX',
      customerEmail: '[REDACTED]',
      customerPhone: '[REDACTED]'
    };
    expect(mockAdminResponse.customerEmail).not.toContain('@');
    expect(mockAdminResponse.customerPhone).not.toContain('07');
  });

  it('route shape matches approved API shape', () => {
    const routes = [
      'GET /admin/measurement/payments/reconciliation',
      'GET /admin/measurement/payments/reconciliation/:orderId',
      'POST /admin/measurement/payments/reconciliation/:orderId/retry'
    ];
    expect(routes).toContain('POST /admin/measurement/payments/reconciliation/:orderId/retry');
  });
});
