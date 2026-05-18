import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../../apps/api/src/interfaces/http/app';
import { Registry } from '../../apps/api/src/infrastructure/Registry';

describe('Order Privacy Isolation Unit Tests', () => {
  let mockOrderRepo: any;

  beforeEach(() => {
    mockOrderRepo = {
      findAll: vi.fn(),
      findById: vi.fn()
    };

    const registry = Registry.getInstance();
    vi.spyOn(registry, 'orderRepo', 'get').mockReturnValue(mockOrderRepo);
  });

  it('should reject non-string lookup parameters with VERIFICATION_FAILED', async () => {
    const res = await app.request('/commerce/orders/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: 12345, contact: '0788000000' })
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VERIFICATION_FAILED');
  });

  it('should immediately block GP-DRAFT order prefixes without accessing database', async () => {
    const res = await app.request('/commerce/orders/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: 'GP-DRAFT-123', contact: '0788000000' })
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe('VERIFICATION_FAILED');
    expect(mockOrderRepo.findAll).not.toHaveBeenCalled();
  });
});
