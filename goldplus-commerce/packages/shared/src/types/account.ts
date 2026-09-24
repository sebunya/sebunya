export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

/**
 * Whether a customer-facing page should offer "Pay now" for an order.
 *
 * No code path ever moves an order to pending_payment: every retail order is
 * created 'received', and a declined PesaPal payment only sets
 * payment_status='failed'. The account API also hands back the DB status in
 * lowercase. So gating the button on status === 'PENDING_PAYMENT' (or
 * 'pending_payment') meant it could never render, while the payment-return
 * page told failed payers to "check the order to pay online again".
 *
 * This is only the page's decision to SHOW the button. The payment use case
 * keeps its own authority (already paid, cancelled, live attempt, ownership).
 */
export function offersOnlinePayment(order: {
  status?: string | null;
  paymentStatus?: string | null;
  paymentMethod?: string | null;
}): boolean {
  const status = String(order.status ?? '').toLowerCase();
  const paymentStatus = String(order.paymentStatus ?? '').toLowerCase();
  const paymentMethod = String(order.paymentMethod ?? '').toLowerCase();
  if (status !== 'received' && status !== 'pending_payment') return false;
  if (!['unpaid', 'pending', 'failed'].includes(paymentStatus)) return false;
  // Cash on delivery is collected by the rider, not online.
  if (paymentMethod === 'offline') return false;
  return true;
}

export interface MeDto {
  id: string;
  email: string;
  phone: string | null;
  createdAt: string;
}

export interface OrderSummaryDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmountUgx: number;
  itemCount: number;
  createdAt: string;
  /** Raw payment status ('unpaid' | 'pending' | 'failed' | 'paid' | …); additive, may be absent on older APIs. */
  paymentStatus?: string | null;
  /** How the customer chose to pay at checkout; null for orders placed before it was recorded. */
  paymentMethod?: string | null;
}

export interface OrderItemDto {
  productId: string;
  productName: string;
  productSlug: string | null;
  unitPriceUgx: number;
  quantity: number;
}

export interface OrderDetailDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmountUgx: number;
  createdAt: string;
  /** See OrderSummaryDto.paymentStatus. */
  paymentStatus?: string | null;
  /** See OrderSummaryDto.paymentMethod. */
  paymentMethod?: string | null;
  items: OrderItemDto[];
  customer: {
    email: string | null;
    phone: string | null;
  };
}

export interface AddressDto {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  district: string;
  areaDetails: string;
  isDefault: boolean;
  // Location module (brief E.2) — optional so pre-module rows stay valid.
  areaSlug?: string | null;
  landmarkText?: string | null;
  additionalDirections?: string | null;
  phoneSecondary?: string | null;
  deliveryMethod?: 'door' | 'pickup_point';
  pickupPointId?: string | null;
  resolutionStatus?: 'resolved' | 'needs_ops_review' | 'ops_confirmed' | 'undeliverable';
  hasPin?: boolean;
  snapshotAreaLabel?: string | null;
}
