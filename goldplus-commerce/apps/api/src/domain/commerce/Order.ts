import { createHash } from 'node:crypto';

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

/**
 * Scopes a client-supplied idempotency key to the customer who supplied it.
 *
 * `client_order_key` is a caller-chosen string carrying a GLOBAL unique index,
 * and checkout looked it up directly and returned the matching order. That order
 * carries the customer's name, phone, email and delivery address, and the
 * checkout response returns it in full.
 *
 * So anyone who guessed or reused a key that another customer had already used
 * received that customer's order back — a PII disclosure requiring nothing but a
 * plausible string, entirely under the caller's control. `min(8)` on the route
 * bounds the length, not the guessability: keys are typically predictable
 * client-generated patterns.
 *
 * Hashing the key together with the customer's own identifier means a key can
 * only ever match within the same customer. It also keeps the raw key out of the
 * database, which is worth having on its own: callers put meaningful data in
 * idempotency keys.
 *
 * Keys written before this change remain raw and will not match a new scoped
 * lookup. The cost is bounded and one-off: a customer retrying an in-flight
 * checkout across the deploy could create a second order, which is the ordinary
 * duplicate-submission case the rest of the pipeline already handles — and a far
 * smaller problem than the disclosure.
 */
export function scopeClientOrderKey(clientOrderKey: string, customerScopeKey: string): string {
  const scope = customerScopeKey.trim().toLowerCase();
  // The NUL separator prevents a boundary collision: without it ("ab","c") and
  // ("a","bc") would hash identically and share an idempotency identity.
  return createHash('sha256').update(`${scope}\u0000${clientOrderKey.trim()}`).digest('hex').slice(0, 64);
}

