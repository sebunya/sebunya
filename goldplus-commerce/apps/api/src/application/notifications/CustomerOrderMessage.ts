import type { Order } from '../../domain/commerce/Order';
import { cancelRefundUpdate } from './CustomerMessages';

/**
 * The outbox idempotency key of one customer order message: at most once per
 * order and template. It is a contract, not a detail — SQL elsewhere builds the
 * same key to find a message already queued (the review reminder's candidate
 * query: `'customer-order-message:' || o.id::text || ':ORDER_REVIEW_REMINDER'`).
 */
export function customerOrderMessageKey(orderId: string, template: string): string {
  return `customer-order-message:${orderId}:${template}`;
}

/** What the composition root reads from the environment for these messages. */
export interface CustomerOrderMessageSettings {
  /** PUBLIC_WEB_BASE_URL: the storefront the message's Track Order link opens. */
  webBaseUrl: string | undefined;
  /** CUSTOMER_ORDER_MESSAGES_LIVE: the string 'false' stops every customer order message (dry run). */
  messagesLive: string | undefined;
}

/** The parts of an order a customer order message is built from. */
export type CustomerOrderMessageOrder = Pick<
  Order,
  | 'customerPhone' | 'customerEmail' | 'customerName' | 'orderNumber' | 'totalUgx' | 'amountDueUgx'
  | 'storeCreditAppliedUgx' | 'createdAt' | 'deliveryFeeUgx' | 'deliveryLocation' | 'deliveryArea'
  | 'paymentStatus' | 'items'
>;

/**
 * One customer order message for the outbox: governed by the TRANSACTIONAL
 * gates, and stopped without a deploy by CUSTOMER_ORDER_MESSAGES_LIVE=false.
 * A pure function of the order (moved out of the Registry, 2026-11; the fields
 * and values are exactly those the Registry built).
 */
export function customerOrderMessage(orderId: string, template: string, order: CustomerOrderMessageOrder, settings: CustomerOrderMessageSettings) {
  return {
    eventType: 'CUSTOMER_ORDER_MESSAGE',
    template,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail ?? null,
    data: {
      template,
      customerName: order.customerName,
      orderNumber: order.orderNumber,
      totalUgx: order.totalUgx,
      // What is still to pay (the total less any gift card / store credit): the payment reminder asks for this.
      amountDueUgx: order.amountDueUgx,
      // 0196: the gift card / store credit part, so payment messages and the receipt name the split.
      ...(order.storeCreditAppliedUgx > 0 ? {
        storeCreditAppliedUgx: order.storeCreditAppliedUgx,
        ...(template === 'ORDER_CANCELLED_BY_SHOP' ? {
          refundUpdate: cancelRefundUpdate({ totalUgx: order.totalUgx, storeCreditAppliedUgx: order.storeCreditAppliedUgx, paymentStatus: order.paymentStatus }),
        } : {}),
        paymentMethod: order.amountDueUgx > 0
          ? `Gift card or store credit ${order.storeCreditAppliedUgx.toLocaleString('en-US')} + Mobile Money or card ${order.amountDueUgx.toLocaleString('en-US')} (UGX)`
          : 'Gift card or store credit',
      } : {}),
      // What the reviewed email templates need to render a real receipt:
      // the lines, the money and where it is going. Without these the
      // adapter cannot fill the design and falls back to the older body.
      orderCreatedAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
      deliveryFeeUgx: order.deliveryFeeUgx ?? 0,
      deliveryLocation: order.deliveryLocation?.displayLabel || order.deliveryArea || '',
      paymentStatus: order.paymentStatus,
      // Track Order, pre-filled: it works for guests (no account) and takes
      // an order NUMBER. /orders/{number} could never resolve — that page
      // reads /account/orders/:id, which answers only a UUID, behind a login.
      orderUrl: `${(settings.webBaseUrl || 'https://shopgoldplus.com').replace(/\/$/, '')}/track-order?reference=${encodeURIComponent(order.orderNumber)}`,
      items: (order.items ?? []).map((i) => ({
        name: i.name,
        quantity: i.quantity,
        unitPriceUgx: i.price,
        lineTotalUgx: i.finalLineTotal ?? i.price * i.quantity,
      })),
    },
    idempotencyKey: customerOrderMessageKey(orderId, template),
    relatedEntity: 'order',
    relatedEntityId: orderId,
    // These messages have been reaching customers all along: the router
    // never consulted this flag, so "deferred until the owner switches it
    // on" was not true — a payment-success SMS went to a real customer on
    // 2026-09-20 while the switch was unset. The flag is now honoured, so
    // the default states what actually happens: customer order messages
    // are LIVE, and CUSTOMER_ORDER_MESSAGES_LIVE=false stops them.
    dryRunOnly: settings.messagesLive === 'false',
  };
}
