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
  | 'RESERVED_EXCEEDS_STOCK' // reserved_quantity > stock_quantity (available < 0)
  | 'DISPATCHED_WITH_RESERVATION' // goods left (order dispatched/delivered/completed, or task past packing) yet a reservation is still 'reserved'
  | 'CANCELLED_AFTER_CONSUME'; // a cancelled order whose stock was already taken off: the units may be back on the shelf

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

/** An order's reservation ledger read against where the order is. */
export interface OrderStockRow {
  orderId: string;
  orderStatus: string;
  /** The fulfilment task status, or null when the order has no task. */
  taskStatus: string | null;
  /** inventory_reservations rows still 'reserved' / already 'consumed'. */
  reservedRows: number;
  consumedRows: number;
}

const GOODS_LEFT_ORDER = new Set(['dispatched', 'delivered', 'completed']);
const TASK_PAST_PACKING = new Set(['READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED']);

/**
 * Stock that should have moved and did not. Both shapes are invisible to the
 * product checks: the reserved figures still agree with each other.
 */
export function checkOrderStock(row: OrderStockRow): ReconciliationException[] {
  const out: ReconciliationException[] = [];
  const goodsLeft = GOODS_LEFT_ORDER.has(row.orderStatus) || (row.taskStatus !== null && TASK_PAST_PACKING.has(row.taskStatus));
  if (goodsLeft && row.reservedRows > 0) {
    out.push({
      type: 'DISPATCHED_WITH_RESERVATION',
      entityKind: 'order',
      entityId: row.orderId,
      detail: { reservedRows: row.reservedRows },
      message: `Order is ${row.orderStatus}${row.taskStatus ? ` (task ${row.taskStatus})` : ''} but still holds ${row.reservedRows} reservation(s): on-hand stock still counts goods that have left.`,
    });
  }
  if (row.orderStatus === 'cancelled' && row.consumedRows > 0) {
    out.push({
      type: 'CANCELLED_AFTER_CONSUME',
      entityKind: 'order',
      entityId: row.orderId,
      detail: { consumedRows: row.consumedRows },
      message: `Cancelled after its stock was taken off (${row.consumedRows} line(s)). If the goods came back, record them with a stock adjustment; nothing restocks automatically.`,
    });
  }
  return out;
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
  orderStock?: OrderStockRow[];
}): ReconciliationException[] {
  return [
    ...input.orders.flatMap(checkOrderMoney),
    ...input.inventory.flatMap(checkInventory),
    ...(input.orderStock ?? []).flatMap(checkOrderStock),
  ];
}
