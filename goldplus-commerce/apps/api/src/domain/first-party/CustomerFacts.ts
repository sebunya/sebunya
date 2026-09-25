/**
 * The facts a customer segment or the value report is computed from, per
 * canonical customer (0155). Assembled by an infrastructure reader from the
 * authoritative tables (orders, order_items, carts, quote_requests) through
 * the customer's identity links; nothing here is estimated or inferred.
 */

export interface OrderFact {
  orderId: string;
  placedAt: Date;
  totalUgx: number;
  status: string;
  paymentStatus: string;
  categoryIds: string[];
  /** 0157: 'offline' (cash on delivery) | 'pesapal' (online) | null (legacy/admin order). */
  paymentMethod?: string | null;
  /** 0157: the delivery district recorded on the order, when there is one. */
  district?: string | null;
}

export interface AbandonedBasketFact {
  cartId: string;
  updatedAt: Date;
  itemCount: number;
}

export interface BulkQuoteFact {
  reference: string;
  createdAt: Date;
}

export interface CustomerFacts {
  canonicalCustomerId: string;
  accountUserId: string | null;
  orders: OrderFact[];
  abandonedBaskets: AbandonedBasketFact[];
  bulkQuotes: BulkQuoteFact[];
}

const NOT_COUNTED = new Set(['cancelled', 'failed']);
const FULFILLED = new Set(['delivered', 'completed']);

/**
 * counted  — a real order the customer placed (not cancelled, not failed).
 * realised — counted AND money is in: paid online, or delivered/completed
 *            (cash on delivery is collected at the door).
 * Lifetime value uses realised orders only; order counts use counted ones.
 */
export function classifyOrder(o: Pick<OrderFact, 'status' | 'paymentStatus'>): { counted: boolean; realised: boolean } {
  const counted = !NOT_COUNTED.has(o.status);
  const realised = counted && (o.paymentStatus === 'paid' || FULFILLED.has(o.status));
  return { counted, realised };
}

export function countedOrders(f: Pick<CustomerFacts, 'orders'>): OrderFact[] {
  return f.orders.filter((o) => classifyOrder(o).counted).sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime());
}

export function realisedSpendUgx(f: Pick<CustomerFacts, 'orders'>): number {
  return f.orders.filter((o) => classifyOrder(o).realised).reduce((s, o) => s + o.totalUgx, 0);
}
