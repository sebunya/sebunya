/**
 * Order fulfilment status — must mirror the domain vocabulary in
 * apps/api/src/domain/commerce/Order.ts exactly. These are the raw values
 * stored in the database; presentation labels/tones live in
 * ./order-presentation so the API and web render them identically.
 */
export type OrderStatus =
  | 'received'
  | 'pending_payment'
  | 'pending_owner_review'
  | 'processing'
  | 'completed'
  | 'cancelled'
  | 'failed';

/** Payment status — a separate axis from fulfilment status. */
export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed';

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
  paymentStatus: PaymentStatus;
  totalAmountUgx: number;
  itemCount: number;
  createdAt: string;
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
  paymentStatus: PaymentStatus;
  totalAmountUgx: number;
  createdAt: string;
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
}
