/**
 * Commerce data-integrity reconciliation (§8). Pure domain — no DB or HTTP.
 *
 * The write path already enforces these invariants; reconciliation is the
 * SECOND line. A bug, a bad import or a manual UPDATE can still drift a stored
 * total or a reserved count, and §8 is explicit that the answer is to SURFACE
 * the exception, never to silently "fix" a number whose correct value we cannot
 * know. Every check here reports; none mutates.
 *
 * Complements the existing order↔payment reconciliation with the two chains it
 * does not cover: money integrity inside an order, and reserved↔ledger↔stock
 * integrity for a product.
 */

export type ReconciliationExceptionType =
  | 'ORDER_TOTAL_MISMATCH' // total_amount != subtotal_amount + delivery_fee - loyalty_discount
  | 'ORDER_LINES_MISMATCH' // subtotal_amount != sum(order_items.final_line_total)
  | 'RESERVED_LEDGER_MISMATCH' // product.reserved_quantity != sum(active reservations)
  | 'RESERVED_EXCEEDS_STOCK'; // reserved_quantity > stock_quantity (available < 0)

export interface ReconciliationException {
  type: ReconciliationExceptionType;
  entityKind: 'order' | 'product';
  entityId: string;
  /** The conflicting values, for the operator to drill into. */
  detail: Record<string, number>;
  message: string;
}

export interface OrderMoneyRow {
  orderId: string;
  totalAmount: number;
  subtotalAmount: number;
  deliveryFee: number;
  /** SUM(order_items.final_line_total) for the order. */
  lineItemsSum: number;
  /**
   * Points redeemed against the order total (Order.create: total = subtotal +
   * delivery - loyaltyDiscount). Optional and defaulted to 0 so legacy callers
   * and non-redeemed orders reconcile unchanged; without it, every loyalty-
   * redeemed order would falsely raise ORDER_TOTAL_MISMATCH.
   */
  loyaltyDiscount?: number;
}

export interface InventoryRow {
  productId: string;
  stockQuantity: number;
  reservedQuantity: number;
  /** SUM(inventory_reservations.reserved_quantity WHERE status='reserved'). */
  ledgerReservedSum: number;
}

/** Money integrity inside a single order. */
export function checkOrderMoney(row: OrderMoneyRow): ReconciliationException[] {
  const out: ReconciliationException[] = [];
  const loyaltyDiscount = row.loyaltyDiscount ?? 0;
  const expectedTotal = row.subtotalAmount + row.deliveryFee - loyaltyDiscount;
  if (row.totalAmount !== expectedTotal) {
    out.push({
      type: 'ORDER_TOTAL_MISMATCH',
      entityKind: 'order',
      entityId: row.orderId,
      detail: { totalAmount: row.totalAmount, subtotalAmount: row.subtotalAmount, deliveryFee: row.deliveryFee, loyaltyDiscount, expectedTotal },
      message: `Order total ${row.totalAmount} != subtotal ${row.subtotalAmount} + delivery ${row.deliveryFee} - loyalty ${loyaltyDiscount} (${expectedTotal}).`,
    });
  }
  if (row.subtotalAmount !== row.lineItemsSum) {
    out.push({
      type: 'ORDER_LINES_MISMATCH',
      entityKind: 'order',
      entityId: row.orderId,
      detail: { subtotalAmount: row.subtotalAmount, lineItemsSum: row.lineItemsSum },
      message: `Order subtotal ${row.subtotalAmount} != sum of line totals ${row.lineItemsSum}.`,
    });
  }
  return out;
}

/** Reserved↔ledger↔stock integrity for a single product. */
export function checkInventory(row: InventoryRow): ReconciliationException[] {
  const out: ReconciliationException[] = [];
  if (row.reservedQuantity !== row.ledgerReservedSum) {
    out.push({
      type: 'RESERVED_LEDGER_MISMATCH',
      entityKind: 'product',
      entityId: row.productId,
      detail: { reservedQuantity: row.reservedQuantity, ledgerReservedSum: row.ledgerReservedSum },
      message: `Product reserved_quantity ${row.reservedQuantity} != active reservation ledger sum ${row.ledgerReservedSum}.`,
    });
  }
  if (row.reservedQuantity > row.stockQuantity) {
    out.push({
      type: 'RESERVED_EXCEEDS_STOCK',
      entityKind: 'product',
      entityId: row.productId,
      detail: { reservedQuantity: row.reservedQuantity, stockQuantity: row.stockQuantity, availableWouldBe: row.stockQuantity - row.reservedQuantity },
      message: `Product reserved ${row.reservedQuantity} exceeds stock ${row.stockQuantity} — available would be negative.`,
    });
  }
  return out;
}

export function reconcileCommerce(input: {
  orders: OrderMoneyRow[];
  inventory: InventoryRow[];
}): ReconciliationException[] {
  return [
    ...input.orders.flatMap(checkOrderMoney),
    ...input.inventory.flatMap(checkInventory),
  ];
}
