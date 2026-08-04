export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED';

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
