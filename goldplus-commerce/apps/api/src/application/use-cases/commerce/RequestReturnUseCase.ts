import type { IOrderDeliveredAt } from '../../ports/IOrderDeliveredAt';
import type { VerifiedOrder } from '../reviews/OrderReviewUseCases';
import type { OpenTaskInput } from '../assistant/CareDeskUseCases';
import { REVIEWABLE_ORDER_STATUSES } from '../../../domain/reviews/ReviewDomain';

/**
 * Self-service returns (gap analysis #8, 2026-10-20). Until now a return started with a WhatsApp message or the
 * general support form. The customer now proves the order (reference + checkout phone or email, the tracking
 * lockout), picks the item, the reason and how it comes back, and the request lands on the Care Desk as an
 * order_problem task with everything staff need, alerted like any other.
 *
 * The published policy decides what is checked here: a change of mind is accepted within 14 days of delivery or
 * collection; a fault, damage or a wrong item is always taken (staff judge the warranty, never this code).
 */
export const CHANGE_OF_MIND_DAYS = 14;
export const RETURN_REASONS = {
  changed_mind: 'Changed my mind',
  faulty: 'It does not work properly',
  damaged: 'It arrived damaged',
  wrong_item: 'It is not what I ordered',
  other: 'Something else',
} as const;
export type ReturnReason = keyof typeof RETURN_REASONS;
export const RETURN_PREFERENCES = { bring_to_shop: 'I will bring it to the shop', collect: 'Please collect it' } as const;
export type ReturnPreference = keyof typeof RETURN_PREFERENCES;

export type RequestReturnResult =
  | { ok: true; created: boolean }
  | { ok: false; reason: 'NOT_DELIVERED' | 'NOT_ON_ORDER' | 'BAD_REASON' | 'BAD_PREFERENCE' | 'TOO_LONG' | 'NEEDS_DETAIL' | 'PAST_CHANGE_OF_MIND' };

export class RequestReturnUseCase {
  constructor(
    private readonly delivered: IOrderDeliveredAt,
    private readonly care: {
      openTask(input: OpenTaskInput): Promise<{ ok: boolean; created?: boolean }>;
      lastTitled(prefix: string, opts?: { exact?: boolean }): Promise<{ status: string } | null>;
    },
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    order: VerifiedOrder & { customerName?: string | null; customerEmail?: string | null },
    input: { productId: string; reason: string; preference: string; detail?: string | null },
  ): Promise<RequestReturnResult> {
    if (!REVIEWABLE_ORDER_STATUSES.has(order.orderStatus)) return { ok: false, reason: 'NOT_DELIVERED' };
    const item = order.items.find((i) => i.productId === input.productId);
    if (!item) return { ok: false, reason: 'NOT_ON_ORDER' };
    if (!(input.reason in RETURN_REASONS)) return { ok: false, reason: 'BAD_REASON' };
    if (!(input.preference in RETURN_PREFERENCES)) return { ok: false, reason: 'BAD_PREFERENCE' };
    const detail = (input.detail ?? '').trim();
    if (detail.length > 1000) return { ok: false, reason: 'TOO_LONG' };
    const reason = input.reason as ReturnReason;
    if ((reason === 'faulty' || reason === 'other') && detail.length < 10) return { ok: false, reason: 'NEEDS_DETAIL' };

    const deliveredAt = await this.delivered.deliveredAt(order.orderNumber).catch(() => null);
    const days = deliveredAt ? (this.now().getTime() - deliveredAt.getTime()) / 86_400_000 : null;
    if (reason === 'changed_mind' && days !== null && days > CHANGE_OF_MIND_DAYS) return { ok: false, reason: 'PAST_CHANGE_OF_MIND' };

    const title = `Return ${order.orderNumber}: ${item.name}`.slice(0, 200);
    // Exactly this item: a prefix match took "Battery BL-4C" for an open "Battery BL-4CT" return and dropped it.
    const last = await this.care.lastTitled(title, { exact: true }).catch(() => null);
    if (last && last.status === 'open') return { ok: true, created: false };

    const lines = [
      `Reason: ${RETURN_REASONS[reason]}`,
      `How it comes back: ${RETURN_PREFERENCES[input.preference as ReturnPreference]}`,
      deliveredAt ? `Delivered or collected: ${deliveredAt.toISOString().slice(0, 10)} (${Math.floor(days ?? 0)} days ago)` : 'Delivery date not recorded',
      detail ? `Customer says: ${detail}` : null,
    ].filter(Boolean);
    const res = await this.care.openTask({
      kind: 'order_problem',
      title,
      detail: lines.join('\n'),
      customerName: order.customerName ?? null,
      customerPhone: order.customerPhone,
      customerEmail: order.customerEmail ?? null,
      orderNumber: order.orderNumber,
      channel: 'web',
      proposedAction: { type: 'return', productId: item.productId, reason, preference: input.preference, daysSinceDelivery: days === null ? null : Math.floor(days) },
      openedBy: 'customer-return-form',
    });
    return { ok: true, created: Boolean(res.created ?? res.ok) };
  }
}
