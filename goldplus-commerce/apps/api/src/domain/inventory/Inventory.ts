/**
 * Inventory ledger domain (Section 12) — pure functions, no Drizzle/Hono.
 *
 * The invariant that prevents overselling: reserved_quantity is never allowed to
 * exceed stock_quantity, so available = stock_quantity - reserved_quantity is
 * always >= 0. A reservation holds min(available, requested); any shortfall is a
 * backorder, surfaced truthfully rather than silently oversold.
 */

export type ReservationStatus = 'reserved' | 'released' | 'consumed';

/**
 * Whether a product may be sold without holding stock.
 *
 * The default for anything unclassified is STOCK_CONTROLLED. The safe reading of
 * an unknown product is that it must be reserved, never that it may be oversold.
 */
export type InventoryPolicy = 'STOCK_CONTROLLED' | 'BACKORDER_ALLOWED' | 'NON_STOCK_ITEM';

export const DEFAULT_INVENTORY_POLICY: InventoryPolicy = 'STOCK_CONTROLLED';

export function parseInventoryPolicy(raw: string | null | undefined): InventoryPolicy {
  switch (raw) {
    case 'BACKORDER_ALLOWED':
    case 'NON_STOCK_ITEM':
    case 'STOCK_CONTROLLED':
      return raw;
    default:
      return DEFAULT_INVENTORY_POLICY;
  }
}

/**
 * What actually happened when stock was reserved for an order.
 *
 * The distinction that matters most is between BACKORDERED and the two failure
 * outcomes. A backorder is a commercial state: the business knowingly sold
 * something it does not hold, and is only reachable for a product whose policy
 * permits it. A failure is a technical state: nobody knows whether stock is
 * available. Collapsing the second into the first — which the previous
 * best-effort contract did for every exception — tells the operator a
 * falsehood and leaves the same units available to the next customer.
 */
export type ReservationOutcomeCode =
  /** Every stock-controlled line is now held. */
  | 'RESERVED'
  /** A prior attempt already reserved this order; nothing further was held. */
  | 'ALREADY_RESERVED'
  /** Stock is genuinely short for a line that requires it. Nothing was held. */
  | 'INSUFFICIENT_STOCK'
  /** Unreserved lines are all backorder-eligible; recorded truthfully as sold short. */
  | 'BACKORDERED'
  /** Transient: deadlock, serialization failure, timeout. Retry may succeed. */
  | 'RETRYABLE_FAILURE'
  /** Non-transient failure. Retrying will not help; the order must not progress. */
  | 'TERMINAL_FAILURE';

/** Reservation state recorded on the order itself. */
export type OrderReservationState =
  | 'PENDING'
  | 'RESERVED'
  | 'BACKORDERED'
  | 'NOT_REQUIRED'
  | 'UNRESERVED_BLOCKED'
  /**
   * Terminals, added 2026-08-06. The vocabulary had no exit: an order whose
   * stock had been released still claimed RESERVED forever — the same
   * entered-never-left trap the payment attempts fell into, on the exact field
   * payment initiation and fulfilment fail closed on. Seven production orders
   * sat in it.
   */
  | 'RELEASED'
  | 'CONSUMED';

/**
 * Whether an order may progress to payment or fulfilment.
 *
 * Fails closed: only states that positively establish the stock position allow
 * progress. PENDING is not "probably fine", it is "nobody has looked yet".
 */
export function mayProgressToPayment(state: OrderReservationState): boolean {
  // RELEASED is deliberately absent: the stock went back on sale, so starting
  // a payment against it would sell goods nobody is holding.
  return state === 'RESERVED' || state === 'BACKORDERED' || state === 'NOT_REQUIRED';
}

export function mayCreateFulfilment(state: OrderReservationState): boolean {
  return mayProgressToPayment(state);
}

/** The order state implied by a reservation outcome. */
export function reservationStateFor(code: ReservationOutcomeCode): OrderReservationState {
  switch (code) {
    case 'RESERVED':
    case 'ALREADY_RESERVED':
      return 'RESERVED';
    case 'BACKORDERED':
      return 'BACKORDERED';
    case 'INSUFFICIENT_STOCK':
    case 'RETRYABLE_FAILURE':
    case 'TERMINAL_FAILURE':
      return 'UNRESERVED_BLOCKED';
  }
}

/**
 * Classifies a database error as retryable or terminal.
 *
 * Deadlock (40P01) and serialization failure (40001) mean the transaction lost a
 * race it can win on a second attempt. Lock timeout and statement timeout are
 * likewise transient under load. Everything else — a constraint violation, a
 * syntax error, a missing column — will fail identically however many times it
 * is retried, and retrying it only delays the truthful answer.
 */
const RETRYABLE_SQLSTATES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57014', // query_canceled (statement timeout)
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '53300', // too_many_connections
]);

export function isRetryableDatabaseError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && RETRYABLE_SQLSTATES.has(code)) return true;
  // Node socket-level failures carry no SQLSTATE.
  if (typeof code === 'string' && ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED'].includes(code)) {
    return true;
  }
  return false;
}

export interface StockPosition {
  stockOnHand: number;
  reserved: number;
  reorderPoint: number;
}

/** Available-to-promise. Never negative. */
export function computeAvailable(stockOnHand: number, reserved: number): number {
  return Math.max(0, stockOnHand - reserved);
}

/** How much of `requested` can actually be reserved right now (never oversells). */
export function reservableQuantity(available: number, requested: number): number {
  if (requested <= 0) return 0;
  return Math.max(0, Math.min(available, requested));
}

/** Backorder shortfall = what could not be reserved. */
export function backorderShortfall(requested: number, reserved: number): number {
  return Math.max(0, requested - reserved);
}

/** Low stock when available at or below the reorder point (and a point is set). */
export function isLowStock(pos: StockPosition): boolean {
  if (pos.reorderPoint <= 0) return false;
  return computeAvailable(pos.stockOnHand, pos.reserved) <= pos.reorderPoint;
}

/**
 * Whether an operator may set on-hand stock to `newStockOnHand` while
 * `currentReserved` units are already promised to customers.
 *
 * Writing stock below what is reserved does not "free up" anything — it strands
 * reservations that were made against units the business no longer claims to
 * have. Nothing downstream reports that: `computeAvailable` clamps at zero and
 * the dispatch deduction clamps at zero, so the position reads as merely
 * out-of-stock while orders sit unfulfillable. The refusal is what makes the
 * situation visible.
 *
 * The remedy is not to force the number through. It is to release or cancel the
 * affected reservations first, which is a commercial decision about specific
 * customer orders and is not this function's to make.
 */
export type StockAdjustmentDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'NEGATIVE_STOCK' | 'RESERVED_EXCEEDS_STOCK';
      currentReserved: number;
      requestedStock: number;
      /** Units that would be promised but unbacked. */
      shortfall: number;
      message: string;
    };

export function validateStockAdjustment(
  currentReserved: number,
  newStockOnHand: number,
): StockAdjustmentDecision {
  if (!Number.isInteger(newStockOnHand) || newStockOnHand < 0) {
    return {
      allowed: false,
      reason: 'NEGATIVE_STOCK',
      currentReserved,
      requestedStock: newStockOnHand,
      shortfall: 0,
      message: 'Stock quantity must be a non-negative whole number.',
    };
  }
  if (newStockOnHand < currentReserved) {
    const shortfall = currentReserved - newStockOnHand;
    return {
      allowed: false,
      reason: 'RESERVED_EXCEEDS_STOCK',
      currentReserved,
      requestedStock: newStockOnHand,
      shortfall,
      message:
        `Cannot set stock to ${newStockOnHand}: ${currentReserved} unit(s) are already ` +
        `reserved for customer orders, so ${shortfall} unit(s) would be promised but ` +
        `unbacked. Release or cancel the affected reservations first, then set the stock.`,
    };
  }
  return { allowed: true };
}

export interface ReservationLineRequest {
  productId: string;
  quantity: number;
}

export interface ReservationLineOutcome {
  productId: string;
  requested: number;
  reserved: number;
  shortfall: number;
  /** Selling policy for the product; absent means the safe default applies. */
  policy?: InventoryPolicy;
}

export interface ReservationOutcome {
  orderId: string;
  lines: ReservationLineOutcome[];
  fullyReserved: boolean;
  /** Human-readable backorder warnings for the fulfilment task. */
  warnings: string[];
  idempotentReplay: boolean;
  /** What actually happened. Never inferred from `fullyReserved` alone. */
  code: ReservationOutcomeCode;
  /** The state to record on the order. */
  state: OrderReservationState;
}

/**
 * Builds the truthful outcome summary from per-line reserved amounts.
 *
 * A line that went unreserved makes the whole reservation a shortfall. Whether
 * that shortfall is a legitimate BACKORDERED sale or a blocking
 * INSUFFICIENT_STOCK depends entirely on the products' policies: if any short
 * line is STOCK_CONTROLLED the order cannot proceed, no matter how many other
 * lines were backorder-eligible.
 */
export function summariseReservation(
  orderId: string,
  lines: ReservationLineOutcome[],
  idempotentReplay = false
): ReservationOutcome {
  const warnings: string[] = [];
  for (const l of lines) {
    if (l.shortfall > 0) {
      warnings.push(`Backorder: ${l.shortfall} of ${l.requested} unit(s) of product ${l.productId} are not in stock.`);
    }
  }

  const fullyReserved = lines.every((l) => l.shortfall === 0);
  const short = lines.filter((l) => l.shortfall > 0);
  const blocking = short.filter(
    (l) => (l.policy ?? DEFAULT_INVENTORY_POLICY) === 'STOCK_CONTROLLED',
  );

  let code: ReservationOutcomeCode;
  if (lines.length === 0) {
    code = 'RESERVED';
  } else if (fullyReserved) {
    code = idempotentReplay ? 'ALREADY_RESERVED' : 'RESERVED';
  } else if (blocking.length > 0) {
    code = 'INSUFFICIENT_STOCK';
    for (const l of blocking) {
      warnings.push(
        `Stock-controlled: product ${l.productId} cannot be sold short. This order cannot proceed until stock is available.`,
      );
    }
  } else {
    code = 'BACKORDERED';
  }

  const everyLineExempt =
    lines.length > 0 && lines.every((l) => (l.policy ?? DEFAULT_INVENTORY_POLICY) === 'NON_STOCK_ITEM');

  return {
    orderId,
    lines,
    fullyReserved,
    warnings,
    idempotentReplay,
    code,
    state: everyLineExempt && !fullyReserved ? 'NOT_REQUIRED' : reservationStateFor(code),
  };
}
