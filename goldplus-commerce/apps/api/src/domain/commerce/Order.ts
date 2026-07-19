export type OrderStatus = 'received' | 'pending_payment' | 'pending_owner_review' | 'processing' | 'completed' | 'cancelled' | 'failed';
export type PaymentStatus = 'unpaid' | 'pending' | 'paid' | 'failed';
export type BuyerType = 'retail' | 'wholesale' | 'corporate';

export interface OrderItem {
  productId: string;
  sku: string;
  name: string;
  price: number;
  quantity: number;
  canonicalUnitPrice?: number;
  baseSubtotal?: number;
  discountAmount?: number;
  finalLineTotal?: number;
}

export interface OrderPricingSnapshot {
  quoteId: string;
  currency: 'UGX';
  baseSubtotalUgx: number;
  discountTotalUgx: number;
  shippingUgx: number;
  taxUgx: number;
  finalTotalUgx: number;
  calculationVersion: string;
  couponReference: string | null;
  appliedPromotionVersions: Array<{ definitionId: string; versionId: string; versionNumber: number }>;
  experimentEvidence: Array<{ experimentId: string; variantKey: string }>;
  adjustments: Array<{ scope: string; productId: string | null; promotionDefinitionId: string; promotionVersionId: string; benefitType: string; amountUgx: number; applicationOrder: number; explanation: string }>;
  evaluatedAt: Date;
}

export interface OrderCustomerDetails {
  name: string;
  email?: string;
  phone: string;
  deliveryArea: string;
  deliveryAddress: string;
  /** Structured Uganda location selection (Slice 3B). Optional for legacy orders. */
  deliveryLocation?: OrderDeliveryLocation | null;
}

/** Persisted structured delivery location — a bounded subset of the shared picker selection. */
export interface OrderDeliveryLocation {
  district: string;
  region?: string;
  countyOrMunicipality?: string;
  subcountyDivisionTc?: string;
  parishWard?: string;
  postcode?: string;
  displayLabel?: string;
}

export class Order {
  constructor(
    public readonly id: string,
    public readonly orderNumber: string,
    public readonly customerName: string,
    public readonly customerPhone: string,
    public readonly customerEmail: string | undefined,
    public readonly deliveryArea: string,
    public readonly deliveryAddress: string,
    public readonly buyerType: BuyerType,
    public readonly items: OrderItem[],
    public readonly subtotalUgx: number,
    public readonly deliveryFeeUgx: number,
    public readonly totalUgx: number,
    public readonly paymentStatus: PaymentStatus,
    public readonly orderStatus: OrderStatus,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly deliveryLocation: OrderDeliveryLocation | null = null,
    /** True only when the fee came from an enabled configured delivery zone. */
    public readonly deliveryFeeConfirmed: boolean = false,
    public readonly pricingSnapshot: OrderPricingSnapshot | null = null
  ) {}

  public static create(
    id: string,
    customer: OrderCustomerDetails,
    buyerType: BuyerType,
    items: OrderItem[],
    deliveryFeeUgx: number = 0,
    deliveryFeeConfirmed: boolean = false,
    pricingSnapshot: OrderPricingSnapshot | null = null
  ): Order {
    const subtotal = pricingSnapshot?.finalTotalUgx != null
      ? pricingSnapshot.finalTotalUgx - pricingSnapshot.shippingUgx - pricingSnapshot.taxUgx
      : items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const total = pricingSnapshot?.finalTotalUgx ?? subtotal + deliveryFeeUgx;
    const timestamp = new Date();
    
    // Business Rule: wholesale/corporate require pending_owner_review
    const initialStatus: OrderStatus = (buyerType === 'wholesale' || buyerType === 'corporate') 
      ? 'pending_owner_review' 
      : 'received';

    return new Order(
      id,
      `GP-${timestamp.getFullYear()}${(timestamp.getMonth()+1).toString().padStart(2,'0')}-${id.substring(0, 4).toUpperCase()}`,
      customer.name,
      customer.phone,
      customer.email,
      customer.deliveryArea,
      customer.deliveryAddress,
      buyerType,
      items,
      subtotal,
      deliveryFeeUgx,
      total,
      'unpaid',
      initialStatus,
      timestamp,
      timestamp,
      customer.deliveryLocation ?? null,
      deliveryFeeConfirmed,
      pricingSnapshot
    );
  }

  public transitionStatus(newStatus: OrderStatus): Order {
    return new Order(
      this.id, this.orderNumber, this.customerName, this.customerPhone, this.customerEmail,
      this.deliveryArea, this.deliveryAddress, this.buyerType, this.items,
      this.subtotalUgx, this.deliveryFeeUgx, this.totalUgx, this.paymentStatus,
      newStatus, this.createdAt, new Date(), this.deliveryLocation, this.deliveryFeeConfirmed, this.pricingSnapshot
    );
  }
}
