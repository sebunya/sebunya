import { describe, expect, it } from 'vitest';
import { customerOutboxValues } from '../../apps/api/src/infrastructure/notifications/CustomerOutboxNotifier';

/**
 * CUSTOMER_ORDER_MESSAGES_LIVE=false marks order messages dryRunOnly, but the notifier wrote the flag only to the row
 * column while the router decides from the payload (NotificationRouter: `payload.dryRunOnly === true`), so the switch
 * sent everything live (2026-10-22 review). The flag now travels in the payload the router reads.
 */
describe('the customer message kill switch reaches the router', () => {
  const base = {
    eventType: 'CUSTOMER_ORDER_MESSAGE', template: 'ORDER_PAYMENT_SUCCESS', customerPhone: '0772000000',
    data: { orderNumber: 'GP-1', totalUgx: 50_000 }, idempotencyKey: 'k', relatedEntity: 'order', relatedEntityId: 'o1',
  };
  it('dry-run messages say so in the payload', () => {
    expect((customerOutboxValues({ ...base, dryRunOnly: true })!.payload as Record<string, unknown>).dryRunOnly).toBe(true);
  });
  it('live messages say so too (never inherit the column default)', () => {
    expect((customerOutboxValues(base)!.payload as Record<string, unknown>).dryRunOnly).toBe(false);
  });
});
