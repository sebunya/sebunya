import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  customerOrderMessage,
  customerOrderMessageKey,
  type CustomerOrderMessageOrder,
} from '../../apps/api/src/application/notifications/CustomerOrderMessage';
import { cancelRefundUpdate } from '../../apps/api/src/application/notifications/CustomerMessages';
// Loaded at collection time, as the other real-Registry tests do: building it takes longer than one test's budget.
import { Registry } from '../../apps/api/src/infrastructure/Registry';

/**
 * The customer order message payload (moved out of the Registry, 2026-11).
 * Until the move it was pinned only by matching Registry source text.
 */

const LIVE = { webBaseUrl: undefined, messagesLive: undefined };

function order(overrides: Partial<Record<keyof CustomerOrderMessageOrder, unknown>> = {}): CustomerOrderMessageOrder {
  return {
    customerPhone: '+256772123456',
    customerEmail: undefined,
    customerName: 'Amina N.',
    orderNumber: 'GP-202611-7Q2X',
    totalUgx: 185_000,
    amountDueUgx: 185_000,
    storeCreditAppliedUgx: 0,
    createdAt: new Date('2026-11-10T08:30:00.000Z'),
    deliveryFeeUgx: 5_000,
    deliveryLocation: null,
    deliveryArea: 'Ntinda',
    paymentStatus: 'paid',
    items: [
      { name: 'GoldPlus 20W charger', quantity: 2, price: 45_000, finalLineTotal: 80_000 },
      { name: 'GoldPlus cable', quantity: 1, price: 25_000 },
    ],
    ...overrides,
  } as unknown as CustomerOrderMessageOrder;
}

describe('customerOrderMessage', () => {
  it('builds the outbox message the Registry used to build inline', () => {
    expect(customerOrderMessage('o-1', 'ORDER_DISPATCHED', order(), LIVE)).toEqual({
      eventType: 'CUSTOMER_ORDER_MESSAGE',
      template: 'ORDER_DISPATCHED',
      customerPhone: '+256772123456',
      customerEmail: null,
      data: {
        template: 'ORDER_DISPATCHED',
        customerName: 'Amina N.',
        orderNumber: 'GP-202611-7Q2X',
        totalUgx: 185_000,
        amountDueUgx: 185_000,
        orderCreatedAt: '2026-11-10T08:30:00.000Z',
        deliveryFeeUgx: 5_000,
        deliveryLocation: 'Ntinda',
        paymentStatus: 'paid',
        orderUrl: 'https://shopgoldplus.com/track-order?reference=GP-202611-7Q2X',
        items: [
          // A recorded line total wins (a discounted line)...
          { name: 'GoldPlus 20W charger', quantity: 2, unitPriceUgx: 45_000, lineTotalUgx: 80_000 },
          // ...otherwise price × quantity.
          { name: 'GoldPlus cable', quantity: 1, unitPriceUgx: 25_000, lineTotalUgx: 25_000 },
        ],
      },
      idempotencyKey: 'customer-order-message:o-1:ORDER_DISPATCHED',
      relatedEntity: 'order',
      relatedEntityId: 'o-1',
      dryRunOnly: false,
    });
  });

  it('names a part payment by gift card or store credit, and a full one', () => {
    const part = customerOrderMessage('o-1', 'ORDER_PAYMENT_SUCCESS', order({ storeCreditAppliedUgx: 50_000, amountDueUgx: 135_000 }), LIVE).data;
    expect(part).toMatchObject({
      storeCreditAppliedUgx: 50_000,
      paymentMethod: 'Gift card or store credit 50,000 + Mobile Money or card 135,000 (UGX)',
    });
    expect(part).not.toHaveProperty('refundUpdate');
    const full = customerOrderMessage('o-1', 'ORDER_PAYMENT_SUCCESS', order({ storeCreditAppliedUgx: 185_000, amountDueUgx: 0 }), LIVE).data;
    expect(full.paymentMethod).toBe('Gift card or store credit');
  });

  it('a shop cancellation of a credit-paid order says what happens to the money', () => {
    const o = order({ storeCreditAppliedUgx: 50_000, amountDueUgx: 135_000, paymentStatus: 'paid' });
    const data = customerOrderMessage('o-1', 'ORDER_CANCELLED_BY_SHOP', o, LIVE).data;
    expect(data.refundUpdate).toBe(cancelRefundUpdate({ totalUgx: 185_000, storeCreditAppliedUgx: 50_000, paymentStatus: 'paid' }));
  });

  it('prefers the delivery location label, then the area, then nothing', () => {
    expect(customerOrderMessage('o', 'T', order({ deliveryLocation: { displayLabel: 'Kira Road, Kamwokya' } }), LIVE).data.deliveryLocation).toBe('Kira Road, Kamwokya');
    expect(customerOrderMessage('o', 'T', order({ deliveryArea: '' }), LIVE).data.deliveryLocation).toBe('');
  });

  it('links to the configured storefront (one trailing slash dropped) and encodes the reference', () => {
    const data = customerOrderMessage('o', 'T', order({ orderNumber: 'GP 1/2' }), { webBaseUrl: 'https://staging.example/', messagesLive: undefined }).data;
    expect(data.orderUrl).toBe('https://staging.example/track-order?reference=GP%201%2F2');
  });

  it('only the string "false" stops the messages', () => {
    expect(customerOrderMessage('o', 'T', order(), { webBaseUrl: undefined, messagesLive: 'false' }).dryRunOnly).toBe(true);
    for (const v of [undefined, '', 'true', 'FALSE', '0']) {
      expect(customerOrderMessage('o', 'T', order(), { webBaseUrl: undefined, messagesLive: v }).dryRunOnly).toBe(false);
    }
  });

  it('the key is the one the review reminder query looks for', () => {
    expect(customerOrderMessageKey('9f0c', 'ORDER_REVIEW_REMINDER')).toBe('customer-order-message:9f0c:ORDER_REVIEW_REMINDER');
  });
});

describe('the Registry sends it with the environment it reads', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads the order, applies PUBLIC_WEB_BASE_URL and CUSTOMER_ORDER_MESSAGES_LIVE, and enqueues once', async () => {
    vi.stubEnv('PUBLIC_WEB_BASE_URL', 'https://preview.shop.test/');
    vi.stubEnv('CUSTOMER_ORDER_MESSAGES_LIVE', 'false');
    const registry = Registry.getInstance();
    const enqueue = vi.fn(async () => 'sent' as const);
    Object.defineProperty(registry, 'orderRepo', { value: { findById: vi.fn(async () => order()) }, configurable: true });
    Object.defineProperty(registry, 'customerOutboxNotifier', { value: { enqueue }, configurable: true });
    await (registry as unknown as { enqueueCustomerOrderMessage: (id: string, t: string) => Promise<void> })
      .enqueueCustomerOrderMessage('o-7', 'ORDER_DISPATCHED');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(customerOrderMessage('o-7', 'ORDER_DISPATCHED', order(), {
      webBaseUrl: 'https://preview.shop.test/', messagesLive: 'false',
    }));
    expect((enqueue.mock.calls[0] as unknown[])[0]).toMatchObject({ dryRunOnly: true, data: { orderUrl: 'https://preview.shop.test/track-order?reference=GP-202611-7Q2X' } });
  });

  it('sends nothing for an order it cannot find', async () => {
    const registry = Registry.getInstance();
    const enqueue = vi.fn(async () => 'sent' as const);
    Object.defineProperty(registry, 'orderRepo', { value: { findById: vi.fn(async () => null) }, configurable: true });
    Object.defineProperty(registry, 'customerOutboxNotifier', { value: { enqueue }, configurable: true });
    await (registry as unknown as { enqueueCustomerOrderMessage: (id: string, t: string) => Promise<void> })
      .enqueueCustomerOrderMessage('missing', 'ORDER_DISPATCHED');
    expect(enqueue).not.toHaveBeenCalled();
  });
});
