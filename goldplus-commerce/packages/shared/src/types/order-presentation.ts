import type { OrderStatus, PaymentStatus } from './account';

/**
 * Presentation metadata for order/payment statuses.
 *
 * Kept framework-agnostic: this returns a human label and a semantic
 * "tone", never CSS classes. Each UI (web, admin, email) maps the small,
 * fixed set of tones to its own styling. This is the single source of
 * truth so every surface renders the same status identically.
 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusMeta {
  label: string;
  tone: StatusTone;
}

const ORDER_STATUS_META: Record<OrderStatus, StatusMeta> = {
  received: { label: 'Received', tone: 'info' },
  pending_payment: { label: 'Awaiting payment', tone: 'warning' },
  pending_owner_review: { label: 'Under review', tone: 'warning' },
  processing: { label: 'Processing', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
};

const PAYMENT_STATUS_META: Record<PaymentStatus, StatusMeta> = {
  unpaid: { label: 'Unpaid', tone: 'warning' },
  pending: { label: 'Payment pending', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  failed: { label: 'Payment failed', tone: 'danger' },
};

const FALLBACK: StatusMeta = { label: 'Unknown', tone: 'neutral' };

/** Prettifies any unexpected raw value defensively (e.g. "in_transit" -> "In transit"). */
function humanize(raw: string): string {
  const cleaned = raw.replace(/[_-]+/g, ' ').trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : FALLBACK.label;
}

export function orderStatusMeta(status: OrderStatus | string): StatusMeta {
  return ORDER_STATUS_META[status as OrderStatus] ?? { label: humanize(String(status)), tone: 'neutral' };
}

export function paymentStatusMeta(status: PaymentStatus | string): StatusMeta {
  return PAYMENT_STATUS_META[status as PaymentStatus] ?? { label: humanize(String(status)), tone: 'neutral' };
}

/** True when the customer still needs to pay (drives "payment pending" prompts). */
export function isAwaitingPayment(paymentStatus: PaymentStatus | string): boolean {
  return paymentStatus === 'unpaid' || paymentStatus === 'pending';
}
