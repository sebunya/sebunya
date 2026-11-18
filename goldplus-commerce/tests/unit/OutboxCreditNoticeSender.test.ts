import { describe, expect, it, vi } from 'vitest';
import { OutboxCreditNoticeSender } from '../../apps/api/src/infrastructure/notifications/OutboxCreditNoticeSender';

/**
 * 0196: the card notices (moved out of the Registry, 2026-11) become ordinary
 * customer messages about the card, never about an order, keyed so a retry
 * cannot send the same notice twice.
 */
describe('OutboxCreditNoticeSender', () => {
  it('queues the notice as a customer message about the card, by phone only', async () => {
    const enqueue = vi.fn(async (_input: unknown) => 'sent' as const);
    const sender = new OutboxCreditNoticeSender({ enqueue });
    await expect(
      sender.send({ template: 'CREDIT_USED', instrumentId: 'ci-7', phone: '+256772111222', idempotencyKey: 'credit-used:o1', data: { balanceUgx: 30000 } }),
    ).resolves.toBeUndefined();
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      eventType: 'CUSTOMER_ORDER_MESSAGE',
      template: 'CREDIT_USED',
      customerPhone: '+256772111222',
      customerEmail: null,
      data: { balanceUgx: 30000 },
      idempotencyKey: 'credit-used:o1',
      relatedEntity: 'credit_instrument',
      relatedEntityId: 'ci-7',
    });
  });

  it('passes the expiry reminder through unchanged, and lets a failed enqueue surface', async () => {
    const enqueue = vi.fn(async (_input: unknown): Promise<'sent' | 'skipped'> => 'skipped');
    const sender = new OutboxCreditNoticeSender({ enqueue });
    await sender.send({ template: 'CREDIT_EXPIRING', instrumentId: 'ci-9', phone: '+256701000000', idempotencyKey: 'credit-expiring:ci-9:2026-11-19', data: {} });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ template: 'CREDIT_EXPIRING', relatedEntityId: 'ci-9', idempotencyKey: 'credit-expiring:ci-9:2026-11-19' }));
    enqueue.mockRejectedValueOnce(new Error('outbox down'));
    await expect(sender.send({ template: 'CREDIT_USED', instrumentId: 'ci-9', phone: '+256701000000', idempotencyKey: 'k', data: {} })).rejects.toThrow('outbox down');
  });
});
