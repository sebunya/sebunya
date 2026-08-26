import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getOrderNotificationTimeline } from '../../apps/web/src/lib/api';

describe('Frontend API Notifications Unit Tests', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return timeline items when the api call is successful', async () => {
    const mockItems = [
      {
        id: 'outbox-1',
        type: 'outbox',
        channel: 'email',
        recipient: 'lo****@domain.com',
        template: 'ORDER_RECEIVED_UNPAID',
        status: 'dry_run',
        timestamp: '2026-05-19T09:50:00.000Z',
        providerCode: null,
        providerMessage: null,
        idempotencyKey: 'key-1',
        dryRunOnly: true,
        previewOnly: false,
        noSendGuarantee: true,
        suppressedReason: null,
      }
    ];

    (fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: mockItems
      })
    });

    const res = await getOrderNotificationTimeline('order-123', 'mock-token');
    expect(res.isSample).toBe(false);
    expect(res.items).toEqual(mockItems);
  });

  it('should return sample format/error representation if the api call fails', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500
    });

    const res = await getOrderNotificationTimeline('order-123', 'mock-token');
    expect(res.isSample).toBe(true);
    expect(res.items).toHaveLength(0);
    expect(res.reason).toBe('The timeline could not be loaded.');
  });

  it('should return sample format/error representation if the api is unreachable', async () => {
    (fetch as any).mockRejectedValue(new Error('Network offline'));

    const res = await getOrderNotificationTimeline('order-123', 'mock-token');
    expect(res.isSample).toBe(true);
    expect(res.items).toHaveLength(0);
    expect(res.reason).toContain('Notifications API is unreachable');
  });
});
