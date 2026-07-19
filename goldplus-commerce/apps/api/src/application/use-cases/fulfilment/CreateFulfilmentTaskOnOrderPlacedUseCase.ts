import { randomUUID } from 'node:crypto';
import { Order } from '../../../domain/commerce/Order';
import { FulfilmentTask, FulfilmentItemLine, FulfilmentPaymentStatus } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';

export interface CreateFulfilmentTaskResult {
  created: boolean;
  taskId: string;
  orderId: string;
}

function toFulfilmentPaymentStatus(status: string): FulfilmentPaymentStatus {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'pending':
      return 'pending';
    case 'failed':
      return 'failed';
    default:
      return 'unpaid';
  }
}

function buildDeliverySummary(order: Order): string {
  const loc = order.deliveryLocation;
  if (loc) {
    const parts = [loc.district, loc.subcountyDivisionTc, loc.parishWard, order.deliveryArea]
      .map((p) => (p ?? '').trim())
      .filter(Boolean);
    const unique = [...new Set(parts)];
    if (unique.length > 0) return unique.join(' · ');
  }
  return [order.deliveryArea, order.deliveryAddress].filter(Boolean).join(' · ');
}

/**
 * OrderPlaced → create one idempotent admin fulfilment task containing every
 * ordered product. Idempotency is guaranteed by the unique order_id constraint
 * in the repository, so duplicate submissions, callbacks and worker retries all
 * collapse to a single task. This never depends on any external provider, so it
 * works even when email / SMS / WhatsApp are unavailable.
 */
export class CreateFulfilmentTaskOnOrderPlacedUseCase {
  constructor(private readonly repo: IFulfilmentRepository) {}

  async execute(
    order: Order,
    opts: { extraWarnings?: string[]; hold?: boolean } = {}
  ): Promise<CreateFulfilmentTaskResult> {
    const existing = await this.repo.findByOrderId(order.id);
    if (existing) {
      return { created: false, taskId: existing.id, orderId: order.id };
    }

    const items: FulfilmentItemLine[] = order.items.map((i) => ({
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitPriceUgx: i.price,
      lineTotalUgx: i.price * i.quantity,
    }));

    const warnings: string[] = [];
    if (opts.hold) {
      warnings.push('ON_HOLD (backordered): insufficient confirmed stock — NOT ready for preparation until stock is confirmed.');
    }
    warnings.push(...(opts.extraWarnings ?? []));
    if (!order.deliveryFeeConfirmed) {
      warnings.push('Delivery fee not from a configured zone — confirm before dispatch.');
    }
    if (order.paymentStatus !== 'paid') {
      warnings.push('Payment not yet confirmed — do not dispatch until paid.');
    }

    const task = FulfilmentTask.openForOrder({
      id: randomUUID(),
      orderId: order.id,
      orderNumber: order.orderNumber,
      paymentStatus: toFulfilmentPaymentStatus(order.paymentStatus),
      paymentMethod: null,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail,
      deliveryArea: order.deliveryArea,
      deliverySummary: buildDeliverySummary(order),
      totalUgx: order.totalUgx,
      deliveryFeeUgx: order.deliveryFeeUgx,
      items,
      warnings,
      hold: opts.hold,
      now: order.createdAt,
    });

    const result = await this.repo.createForOrder(task);
    return { created: result.created, taskId: result.task.id, orderId: order.id };
  }
}
