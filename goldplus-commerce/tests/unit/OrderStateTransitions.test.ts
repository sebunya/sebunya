import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../../apps/api/src/interfaces/http/app';
import { Registry } from '../../apps/api/src/infrastructure/Registry';
import { Order } from '../../apps/api/src/domain/commerce/Order';

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
    const auth = c.req.header('Authorization');
    if (auth === 'Bearer token-no-manage' && perms.includes('orders.manage')) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403);
    }
    await next();
  },
}));

describe('Order State Transitions Unit Tests', () => {
  let mockOrderRepo: any;
  let mockAuditRepo: any;
  let mockTransition: any;

  beforeEach(() => {
    mockOrderRepo = {
      findById: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined)
    };

    mockAuditRepo = {
      save: vi.fn().mockResolvedValue(undefined),
      findAll: vi.fn(),
      findByEntity: vi.fn()
    };

    // The admin route persists transitions through the canonical service, not
    // orderRepo.save. Mock it so this unit test needs no database.
    mockTransition = {
      transition: vi.fn().mockResolvedValue({
        orderId: 'order-1', fromStatus: 'received', toStatus: 'processing',
        eventId: 'evt-1', idempotentReplay: false,
      }),
      history: vi.fn().mockResolvedValue([]),
    };

    const registry = Registry.getInstance();

    Object.defineProperty(registry, 'orderRepo', {
      value: mockOrderRepo,
      writable: true,
      configurable: true
    });

    Object.defineProperty(registry, 'auditRepo', {
      value: mockAuditRepo,
      writable: true,
      configurable: true
    });

    Object.defineProperty(registry, 'orderTransitionService', {
      value: mockTransition,
      writable: true,
      configurable: true
    });
  });

  it('should reject transition if the admin lacks manage permissions', async () => {
    const res = await app.request('/governance/admin/orders/order-1/fulfillment', {
      method: 'PATCH',
      headers: { 
        Authorization: 'Bearer token-no-manage',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'processing' })
    });

    expect(res.status).toBe(403);
  });

  it('should allow valid transition from received to processing', async () => {
    const order = new Order(
      'order-1', 'GP-1001', 'Alice', '0788', undefined, 'Kla', 'Add',
      'retail', [], 100000, 0, 100000, 'unpaid', 'received', new Date(), new Date()
    );
    mockOrderRepo.findById.mockResolvedValue(order);

    const res = await app.request('/governance/admin/orders/order-1/fulfillment', {
      method: 'PATCH',
      headers: { 
        Authorization: 'Bearer token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'processing' })
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.orderStatus).toBe('processing');
    // Persistence now goes through the canonical transition service (which writes
    // the status change AND an order_event atomically), not orderRepo.save.
    expect(mockTransition.transition).toHaveBeenCalledWith('order-1', 'processing', expect.objectContaining({
      actorType: 'administrator',
      source: 'admin_api',
    }));
  });

  it('should allow transition from received to cancelled', async () => {
    const order = new Order(
      'order-1', 'GP-1001', 'Alice', '0788', undefined, 'Kla', 'Add',
      'retail', [], 100000, 0, 100000, 'unpaid', 'received', new Date(), new Date()
    );
    mockOrderRepo.findById.mockResolvedValue(order);

    const res = await app.request('/governance/admin/orders/order-1/fulfillment', {
      method: 'PATCH',
      headers: { 
        Authorization: 'Bearer token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'cancelled' })
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.orderStatus).toBe('cancelled');
  });

  it('should block processing an unpaid order that is pending_payment', async () => {
    const order = new Order(
      'order-1', 'GP-1001', 'Alice', '0788', undefined, 'Kla', 'Add',
      'retail', [], 100000, 0, 100000, 'unpaid', 'pending_payment', new Date(), new Date()
    );
    mockOrderRepo.findById.mockResolvedValue(order);

    const res = await app.request('/governance/admin/orders/order-1/fulfillment', {
      method: 'PATCH',
      headers: { 
        Authorization: 'Bearer token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'processing' })
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('TRANSITION_BLOCKED');
  });

  it('should allow processing a paid order that is pending_payment', async () => {
    const order = new Order(
      'order-1', 'GP-1001', 'Alice', '0788', undefined, 'Kla', 'Add',
      'retail', [], 100000, 0, 100000, 'paid', 'pending_payment', new Date(), new Date()
    );
    mockOrderRepo.findById.mockResolvedValue(order);

    const res = await app.request('/governance/admin/orders/order-1/fulfillment', {
      method: 'PATCH',
      headers: { 
        Authorization: 'Bearer token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'processing' })
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.orderStatus).toBe('processing');
  });

  it('should reject invalid transition completed to received', async () => {
    const order = new Order(
      'order-1', 'GP-1001', 'Alice', '0788', undefined, 'Kla', 'Add',
      'retail', [], 100000, 0, 100000, 'paid', 'completed', new Date(), new Date()
    );
    mockOrderRepo.findById.mockResolvedValue(order);

    const res = await app.request('/governance/admin/orders/order-1/fulfillment', {
      method: 'PATCH',
      headers: { 
        Authorization: 'Bearer token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'received' })
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('TRANSITION_BLOCKED');
  });

  it('should preserve payment status and never modify it during transitions', async () => {
    const order = new Order(
      'order-1', 'GP-1001', 'Alice', '0788', undefined, 'Kla', 'Add',
      'retail', [], 100000, 0, 100000, 'paid', 'processing', new Date(), new Date()
    );
    mockOrderRepo.findById.mockResolvedValue(order);

    const res = await app.request('/governance/admin/orders/order-1/fulfillment', {
      method: 'PATCH',
      headers: { 
        Authorization: 'Bearer token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status: 'completed' })
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.paymentStatus).toBe('paid'); // remains paid
  });
});
