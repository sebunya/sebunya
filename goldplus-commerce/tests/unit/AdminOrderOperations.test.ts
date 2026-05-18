import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../../apps/api/src/interfaces/http/app';
import { Registry } from '../../apps/api/src/infrastructure/Registry';

vi.mock("../../apps/api/src/interfaces/http/middleware/auth", () => ({
  authMiddleware: async (c: any, next: any) => {
    const auth = c.req.header('Authorization');
    if (!auth || !auth.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }
    c.set("user", { id: "user-admin", email: "admin@goldplus.com" });
    await next();
  },
}));

vi.mock("../../apps/api/src/interfaces/http/middleware/permissions", () => ({
  requirePermissions: (perms: string[]) => async (c: any, next: any) => {
    // For test simulation, let's look for specific token triggers or headers
    const auth = c.req.header('Authorization');
    if (auth === 'Bearer token-no-manage' && perms.includes('orders.manage')) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403);
    }
    await next();
  },
}));

describe('Admin Order Operations Unit Tests', () => {
  let mockOrderRepo: any;
  let mockPaymentRepo: any;

  beforeEach(() => {
    mockOrderRepo = {
      findAll: vi.fn().mockResolvedValue([
        {
          id: 'order-1',
          orderNumber: 'GP-1001',
          customerName: 'Alice Nansubuga',
          customerPhone: '0788000001',
          customerEmail: 'alice@gmail.com',
          buyerType: 'retail',
          totalUgx: 250000,
          paymentStatus: 'unpaid',
          orderStatus: 'received',
          createdAt: new Date().toISOString()
        },
        {
          id: 'order-2',
          orderNumber: 'GP-1002',
          customerName: 'Bob Sebunya',
          customerPhone: '0788000002',
          customerEmail: 'bob@example.com',
          buyerType: 'wholesale',
          totalUgx: 1500000,
          paymentStatus: 'paid',
          orderStatus: 'processing',
          createdAt: new Date().toISOString()
        }
      ]),
      findById: vi.fn()
    };

    mockPaymentRepo = {
      findAttemptsByOrderId: vi.fn().mockResolvedValue([
        {
          id: 'attempt-1',
          orderId: 'order-2',
          merchantReference: 'GP-GP-1002-order-uu',
          orderTrackingId: 'pesapal-tracking-123',
          amount: 1500000,
          currency: 'UGX',
          status: 'completed',
          provider: 'pesapal',
          ipnReceivedAt: new Date(),
          callbackReceivedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ])
    };

    const registry = Registry.getInstance();
    vi.spyOn(registry, 'orderRepo', 'get').mockReturnValue(mockOrderRepo);
    vi.spyOn(registry, 'pesapalPaymentRepo', 'get').mockReturnValue(mockPaymentRepo);
  });

  it('should block unauthenticated admin list queries', async () => {
    const res = await app.request('/governance/admin/orders');
    expect(res.status).toBe(401);
  });

  it('should allow list access for authorized admin requests', async () => {
    const res = await app.request('/governance/admin/orders', {
      headers: { Authorization: 'Bearer valid-token-123' }
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(2);
  });

  it('should support search query filter on order list', async () => {
    const res = await app.request('/governance/admin/orders?search=Alice', {
      headers: { Authorization: 'Bearer valid-token-123' }
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].customerName).toBe('Alice Nansubuga');
  });

  it('should support status filter on order list', async () => {
    const res = await app.request('/governance/admin/orders?status=processing', {
      headers: { Authorization: 'Bearer valid-token-123' }
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].orderNumber).toBe('GP-1002');
  });

  it('should query order detail successfully and retrieve associated payment attempts', async () => {
    mockOrderRepo.findById.mockResolvedValue({
      id: 'order-2',
      orderNumber: 'GP-1002',
      customerName: 'Bob Sebunya'
    });

    const res = await app.request('/governance/admin/orders/order-2', {
      headers: { Authorization: 'Bearer valid-token-123' }
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.order.customerName).toBe('Bob Sebunya');
    expect(json.data.paymentAttempts.length).toBe(1);
    expect(json.data.paymentAttempts[0].status).toBe('completed');
  });

  it('should strictly exclude raw secret files and credentials from order attempts payload', async () => {
    mockOrderRepo.findById.mockResolvedValue({
      id: 'order-2',
      orderNumber: 'GP-1002',
      customerName: 'Bob Sebunya'
    });

    const res = await app.request('/governance/admin/orders/order-2', {
      headers: { Authorization: 'Bearer valid-token-123' }
    });

    const bodyText = await res.text();
    expect(bodyText).not.toContain('test-secret');
    expect(bodyText).not.toContain('pesapalConsumerSecret');
    expect(bodyText).not.toContain('consumer_secret');
  });
});
