/**
 * Typed outcomes for the dependencies checkout calls.
 *
 * These exist so an expected commerce decision never has to be recovered by
 * parsing an exception message. `error.message.startsWith('PRODUCT_UNAVAILABLE')`
 * couples the caller to human-readable text: reword the message and the branch
 * silently stops matching, and a genuine database fault whose message happens to
 * begin with the same word is misclassified as a business rejection.
 */

export type CheckoutDependencyCode =
  | 'PRODUCT_UNAVAILABLE'
  | 'PRICE_UNAVAILABLE'
  | 'PRICE_CHANGED'
  | 'PROMOTION_CHANGED'
  | 'DELIVERY_NOT_SUPPORTED'
  | 'CAPACITY_UNAVAILABLE'
  /** A promotion's usage limit was reached (for everyone, for this code, or for this customer). */
  | 'PROMOTION_LIMIT_REACHED'
  /** Pay on delivery is refused for this destination or above its ceiling: paying online works. */
  | 'PAY_ON_DELIVERY_UNAVAILABLE'
  /** The points could not be used on this order; without them it goes through. */
  | 'LOYALTY_REDEMPTION_REFUSED'
  | 'DATABASE_RETRYABLE'
  | 'LEASE_LOST';

/** Codes a customer may safely be shown, and which a retry cannot fix. */
export const TERMINAL_DEPENDENCY_CODES: readonly CheckoutDependencyCode[] = [
  'PRODUCT_UNAVAILABLE',
  'PRICE_UNAVAILABLE',
  'PRICE_CHANGED',
  'PROMOTION_CHANGED',
  'DELIVERY_NOT_SUPPORTED',
  'CAPACITY_UNAVAILABLE',
  'PROMOTION_LIMIT_REACHED',
  'PAY_ON_DELIVERY_UNAVAILABLE',
  'LOYALTY_REDEMPTION_REFUSED',
];

/**
 * Thrown by an adapter that has already classified the failure.
 *
 * Adapters own the translation because they are the layer that knows what the
 * underlying error means; the use case must not guess.
 */
export class CheckoutDependencyError extends Error {
  constructor(
    readonly code: CheckoutDependencyCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'CheckoutDependencyError';
  }
}

export function isCheckoutDependencyError(e: unknown): e is CheckoutDependencyError {
  return e instanceof CheckoutDependencyError;
}

export function isTerminalDependencyCode(code: CheckoutDependencyCode): boolean {
  return TERMINAL_DEPENDENCY_CODES.includes(code);
}

/**
 * Classifies an unclassified error at the adapter boundary.
 *
 * Legacy adapters still throw plain Errors with prefixed messages. Translating
 * here — once, at the boundary — keeps the parsing out of the use case while the
 * adapters are migrated, and makes the remaining coupling explicit and countable
 * rather than scattered through the workflow.
 */
const LEGACY_PREFIXES: ReadonlyArray<[string, CheckoutDependencyCode]> = [
  ['PRODUCT_UNAVAILABLE', 'PRODUCT_UNAVAILABLE'],
  ['PRICE_UNAVAILABLE', 'PRICE_UNAVAILABLE'],
  ['PRICE_CHANGED', 'PRICE_CHANGED'],
  ['PROMOTION_CHANGED', 'PROMOTION_CHANGED'],
  ['PRICING_RESERVATION_COMMIT_MISMATCH', 'CAPACITY_UNAVAILABLE'],
  ['PRICING_QUOTE_COMMIT_MISMATCH', 'PRICE_CHANGED'],
  ['CHECKOUT_LEASE_LOST', 'LEASE_LOST'],
  // These fell through to CHECKOUT_ERROR, FAILED_RETRYABLE and "Please try again" for refusals a retry cannot fix.
  ['PROMOTION_GLOBAL_LIMIT_REACHED', 'PROMOTION_LIMIT_REACHED'],
  ['PROMOTION_CUSTOMER_LIMIT_REACHED', 'PROMOTION_LIMIT_REACHED'],
  ['PROMOTION_COUPON_LIMIT_REACHED', 'PROMOTION_LIMIT_REACHED'],
  ['PROMOTION_NOT_ACTIVE', 'PROMOTION_CHANGED'],
  ['COD_NOT_AVAILABLE', 'PAY_ON_DELIVERY_UNAVAILABLE'],
  ['COD_LIMIT_EXCEEDED', 'PAY_ON_DELIVERY_UNAVAILABLE'],
];

/** Typed pricing refusals (PricingEvaluationError carries its code, not a message prefix). */
const CODED_ERRORS: Readonly<Record<string, CheckoutDependencyCode>> = {
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  PRICE_UNAVAILABLE: 'PRICE_UNAVAILABLE',
};

export function classifyDependencyError(error: unknown): CheckoutDependencyError | null {
  if (isCheckoutDependencyError(error)) return error;
  const coded = (error as { code?: unknown } | null)?.code;
  if (typeof coded === 'string' && CODED_ERRORS[coded]) return new CheckoutDependencyError(CODED_ERRORS[coded]);
  const message = error instanceof Error ? error.message : '';
  const match = LEGACY_PREFIXES.find(([prefix]) => message.startsWith(prefix));
  return match ? new CheckoutDependencyError(match[1]) : null;
}
