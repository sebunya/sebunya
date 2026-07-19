import { Order } from '../../../domain/commerce/Order';
import { IOutboxRepository } from '../../ports/IOutboxRepository';
import {
  AdminOrderEmailEvent,
  buildAdminEmailIdempotencyKey,
  deriveAdminPreparationState,
  renderAdminOrderEmail,
  AdminOrderEmailItem,
} from '../../../domain/notifications/AdminOrderEmail';

export const ADMIN_ORDER_EMAIL_EVENT_TYPE = 'ADMIN_ORDER_EMAIL';

function maskContact(phone: string | null | undefined, email: string | null | undefined): string {
  const p = (phone ?? '').trim();
  if (p.length >= 6) return p.slice(0, 3) + '****' + p.slice(-2);
  const e = (email ?? '').trim();
  if (e.includes('@')) {
    const [name, domain] = e.split('@');
    return `${name.slice(0, 1)}***@${domain}`;
  }
  return '*****';
}

function adminOrderLink(orderId: string): string {
  const base = (process.env.ADMIN_ORDER_LINK_BASE_URL || process.env.PUBLIC_WEB_BASE_URL || 'https://shopgoldplus.com')
    .replace(/\/+$/, '');
  return `${base}/admin/fulfilment?order=${encodeURIComponent(orderId)}`;
}

export interface EnqueueAdminOrderEmailInput {
  order: Order;
  event: AdminOrderEmailEvent;
  /** Truthful stock confirmation — a held/backordered order is never stock-confirmed. */
  stockConfirmed: boolean;
}

export interface EnqueueAdminOrderEmailResult {
  enqueued: boolean;
  idempotencyKey: string;
}

/**
 * Persist exactly one idempotent admin-order-email outbox intent per order event.
 * The unique idempotency key + onConflictDoNothing guarantees a duplicate
 * OrderPlaced / PaymentConfirmed / OrderCancelled never enqueues twice. The
 * intent is dry-run (no provider call) until external delivery is activated; the
 * order/fulfilment/notification all remain available even if this row is absent.
 */
export class EnqueueAdminOrderEmailUseCase {
  constructor(private readonly outbox: IOutboxRepository) {}

  async execute(input: EnqueueAdminOrderEmailInput): Promise<EnqueueAdminOrderEmailResult> {
    const { order, event, stockConfirmed } = input;
    const paymentConfirmed = order.paymentStatus === 'paid';
    const preparationState = deriveAdminPreparationState({ event, paymentConfirmed, stockConfirmed });

    const items: AdminOrderEmailItem[] = order.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitPriceUgx: i.price,
      lineTotalUgx: i.price * i.quantity,
    }));

    const rendered = renderAdminOrderEmail({
      event,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      preparationState,
      paymentMethod: null,
      paymentStatus: order.paymentStatus,
      stockConfirmed,
      totalUgx: order.totalUgx,
      deliveryFeeUgx: order.deliveryFeeUgx,
      customerDisplayName: order.customerName,
      customerContactMasked: maskContact(order.customerPhone, order.customerEmail),
      deliverySummary: order.deliveryLocation?.displayLabel || order.deliveryArea,
      items,
      adminOrderLink: adminOrderLink(order.id),
      warnings: preparationState === 'ON_HOLD_STOCK' ? ['Stock not confirmed — order is ON_HOLD / backordered.'] : [],
    });

    const idempotencyKey = buildAdminEmailIdempotencyKey(order.id, event);
    // Structured data lives alongside the pre-rendered bodies so the provider can
    // send them verbatim; no secrets or raw PII are included.
    const payload = {
      kind: ADMIN_ORDER_EMAIL_EVENT_TYPE,
      event,
      orderId: order.id,
      orderNumber: order.orderNumber,
      preparationState,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      relatedEntity: 'order',
      relatedEntityId: order.id,
    };

    const { enqueued } = await this.outbox.enqueueAdminOrderEmail({
      idempotencyKey,
      payload,
      relatedEntityId: order.id,
    });

    return { enqueued, idempotencyKey };
  }
}
