import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../../apps/api/src/interfaces/http/app';
import { Registry } from '../../apps/api/src/infrastructure/Registry';

vi.mock("../../apps/api/src/interfaces/http/middleware/auth", () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set("user", { id: "user-admin", email: "admin@goldplus.com" });
    await next();
  },
}));

vi.mock("../../apps/api/src/interfaces/http/middleware/permissions", () => ({
  requirePermissions: () => async (c: any, next: any) => {
    await next();
  },
}));

describe('ListOrderNotificationsRoute Unit Tests', () => {
  let mockListOrderNotificationsUseCase: any;

  beforeEach(() => {
    mockListOrderNotificationsUseCase = {
      execute: vi.fn()
    };

    const registry = Registry.getInstance();
    vi.spyOn(registry, 'listOrderNotificationsUseCase', 'get').mockReturnValue(mockListOrderNotificationsUseCase);
  });

  it('should return masked timeline items for order timeline endpoint', async () => {
    mockListOrderNotificationsUseCase.execute.mockResolvedValue([
      {
        id: 'outbox-1',
        type: 'outbox',
        channel: 'sms',
        recipient: '256705004545',
        template: 'ORDER_PAYMENT_SUCCESS',
        status: 'pending',
        timestamp: new Date('2026-05-19T09:50:00.000Z'),
        providerCode: null,
        providerMessage: null,
        idempotencyKey: 'key-1',
        dryRunOnly: true,
        previewOnly: false,
        noSendGuarantee: false,
        suppressedReason: null,
      },
      {
        id: 'attempt-1',
        type: 'attempt',
        channel: 'email',
        recipient: 'john.doe@example.com',
        template: 'ORDER_PAYMENT_SUCCESS',
        status: 'sent',
        timestamp: new Date('2026-05-19T10:00:00.000Z'),
        providerCode: '200',
        providerMessage: 'Delivered Bearer token-12345678',
        idempotencyKey: null,
        dryRunOnly: false,
        previewOnly: false,
        noSendGuarantee: false,
        suppressedReason: null,
      }
    ]);

    const res = await app.request('/admin/notifications/order/order-123/timeline', {
      headers: { Authorization: 'Bearer valid-token-123' }
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);

    // Timeline is sorted chronologically, so outbox-1 (09:50) is index 0
    expect(json.data[0].id).toBe('outbox-1');
    expect(json.data[0].recipient).toBe('25670*****45'); // Masked phone number

    expect(json.data[1].id).toBe('attempt-1');
    expect(json.data[1].recipient).toBe('jo****@example.com'); // Masked email address
    expect(json.data[1].providerMessage).toBe('Delivered Bearer [REDACTED]'); // Scrubbed credentials
  });
});
