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
  constructor(
    private readonly outbox: IOutboxRepository,
    /**
     * Where a rendering failure is reported. Injected rather than logged here:
     * this layer has no logger, and a money-adjacent fallback must not be
     * announced with console.* that nobody reads.
     */
    private readonly onTemplateFallback?: (orderId: string, error: unknown) => void,
  ) {}

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

    /**
     * The reviewed design (apps/api/templates/email), rendered from the same
     * files submitted to the provider, so what staff receive and what was shown
     * for review are the same bytes.
     *
     * If the mapping ever falls short the renderer throws naming the missing
     * field, and the pre-rendered body above still goes out: a sale
     * notification is not worth losing to a copy change.
     */
    let designed: { subject: string; html: string; text: string } | null = null;
    try {
      const { adminEmailData, renderEmailTemplate } = await import('../../../infrastructure/notifications/email/emailTemplateData');
      designed = renderEmailTemplate('ADMIN_ORDER_EMAIL', adminEmailData({
        orderNumber: order.orderNumber,
        createdAt: order.createdAt,
        eventLabel: event === 'payment-confirmed' ? 'Payment confirmed' : event === 'cancelled' ? 'Order cancelled' : 'New order',
        preparationState: preparationState.replace(/_/g, ' ').toLowerCase(),
        preparationInstruction: preparationState === 'ON_HOLD_STOCK'
          ? 'Stock is not confirmed. Do not prepare this order until stock is verified.'
          : preparationState === 'AWAITING_PAYMENT'
            ? 'Payment is not confirmed yet. Do not dispatch until it is paid.'
            : 'Pick, pack and prepare this order for delivery.',
        paymentStatus: order.paymentStatus,
        stockConfirmed,
        totalUgx: order.totalUgx,
        deliveryFeeUgx: order.deliveryFeeUgx,
        customerName: order.customerName,
        customerContactMasked: maskContact(order.customerPhone, order.customerEmail),
        deliveryLocation: order.deliveryLocation?.displayLabel || order.deliveryArea,
        deliveryAddress: order.deliveryAddress || order.deliveryLocation?.displayLabel || order.deliveryArea,
        adminUrl: adminOrderLink(order.id),
        items,
      }));
    } catch (error) {
      // Never silent: the fallback body still sends, but somebody must know the
      // reviewed design stopped rendering.
      this.onTemplateFallback?.(order.id, error);
    }

    const idempotencyKey = buildAdminEmailIdempotencyKey(order.id, event);
    // Structured data lives alongside the pre-rendered bodies so the provider can
    // send them verbatim; no secrets or raw PII are included.
    const payload = {
      kind: ADMIN_ORDER_EMAIL_EVENT_TYPE,
      event,
      orderId: order.id,
      orderNumber: order.orderNumber,
      preparationState,
      subject: designed?.subject ?? rendered.subject,
      text: designed?.text ?? rendered.text,
      html: designed?.html ?? rendered.html,
      renderedFrom: designed ? 'reviewed-template' : 'fallback',
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
