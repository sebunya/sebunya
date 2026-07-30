/**
 * The checkout contract shared by the storefront (BFF) and the Commerce API.
 *
 * WHY THIS IS SHARED RATHER THAN DUPLICATED
 * The API changed its checkout response to a minimal DTO returning `orderId`,
 * while the Astro page kept reading `res.data.id`. Nothing failed loudly: the id
 * was simply `undefined`, the PesaPal branch was skipped, and the customer was
 * shown the offline-review message instead of being sent to pay. A silently
 * broken payment handoff is exactly what an untyped `data: unknown` boundary
 * produces, so the boundary now has one definition both sides import.
 */

/** What the storefront may do next. Derived server-side, never client-decided. */
export type CheckoutNextAction =
  | 'AWAIT_PAYMENT'
  | 'AWAIT_STOCK_CONFIRMATION'
  | 'CONTACT_SUPPORT'
  | 'NONE';

export type OrderReservationStateDto =
  | 'PENDING'
  | 'RESERVED'
  | 'BACKORDERED'
  | 'NOT_REQUIRED'
  | 'UNRESERVED_BLOCKED';

/**
 * The public checkout result.
 *
 * Deliberately carries no contact or address details. The caller just submitted
 * them; echoing them back only copies PII into proxy logs and browser caches.
 * The authenticated account order-detail route serves the customer's own full
 * view after object-level authorization.
 */
export interface CheckoutResponseDto {
  orderId: string;
  orderNumber: string;
  checkoutState: string;
  paymentState: string;
  reservationState: OrderReservationStateDto;
  deliveryFeeConfirmed: boolean;
  totalAmount: number;
  currency: string;
  nextAction: CheckoutNextAction;
  idempotentReplay: boolean;
}

/**
 * Typed checkout error codes.
 *
 * Enumerated because the storefront must react differently to each: a conflict
 * needs a fresh checkout, an in-progress needs a wait, an expired intent needs a
 * re-bootstrap. A single generic failure string forces the UI to guess.
 */
export type CheckoutErrorCode =
  | 'CHECKOUT_INTENT_REQUIRED'
  | 'CHECKOUT_INTENT_EXPIRED'
  | 'CHECKOUT_INTENT_INVALID'
  | 'CHECKOUT_INTENT_REVOKED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'CHECKOUT_IN_PROGRESS'
  | 'STOCK_NOT_RESERVED'
  | 'CHECKOUT_FAILED'
  | 'INVALID_CHECKOUT'
  | 'PRODUCT_UNAVAILABLE'
  | 'PRICE_UNAVAILABLE'
  | 'PRICE_CHANGED'
  | 'PROMOTION_CHANGED'
  | 'ORDER_FAILED'
  | 'CHECKOUT_SESSION_UNAVAILABLE'
  | 'DB_NOT_CONFIGURED';

/**
 * The checkout request contract.
 *
 * Typed rather than `unknown`: an untyped request boundary is how the response
 * boundary drifted unnoticed, and the same argument applies in both directions.
 * Note there is NO client order key — the operation identity is derived
 * server-side from the verified principal and the signed intent id, so the caller
 * cannot influence it.
 */
export interface CheckoutDeliveryLocationDto {
  district: string;
  region?: string;
  countyOrMunicipality?: string;
  subcountyDivisionTc?: string;
  parishWard?: string;
  postcode?: string;
  displayLabel?: string;
}

export interface CheckoutCustomerDetailsDto {
  name: string;
  email?: string;
  phone: string;
  deliveryArea: string;
  deliveryAddress: string;
  deliveryLocation?: CheckoutDeliveryLocationDto | null;
}

export interface CheckoutLineItemDto {
  productId: string;
  quantity: number;
}

export interface CheckoutRequestDto {
  customerDetails: CheckoutCustomerDetailsDto;
  buyerType: 'retail' | 'wholesale' | 'corporate';
  items: CheckoutLineItemDto[];
  couponCode?: string | null;
  previewQuoteId?: string | null;
  acceptPriceChange?: boolean;
}

export interface PaymentStartRequestDto {
  orderId: string;
}

export interface PaymentStartResponseDto {
  redirectUrl: string;
  paymentAttemptId: string;
  providerReference: string | null;
}

/** Header carrying the BFF-issued checkout intent token to the API. */
export const CHECKOUT_INTENT_HEADER = 'x-goldplus-checkout-intent';

/** Browser cookie holding the intent. __Host- prefix in production. */
export const CHECKOUT_INTENT_COOKIE_PROD = '__Host-gp_checkout_intent';
export const CHECKOUT_INTENT_COOKIE_DEV = 'gp_checkout_intent';

export function checkoutIntentCookieName(isProduction: boolean): string {
  // __Host- requires Secure and no Domain, which cannot be satisfied over plain
  // HTTP in local development — the browser would silently drop the cookie.
  return isProduction ? CHECKOUT_INTENT_COOKIE_PROD : CHECKOUT_INTENT_COOKIE_DEV;
}

/**
 * Whether payment may be started.
 *
 * A single predicate both layers import, so the storefront cannot start a
 * payment for a state the API considers unpayable. Previously the page only
 * checked that it had an order id.
 */
export function mayStartPayment(dto: CheckoutResponseDto): boolean {
  return dto.nextAction === 'AWAIT_PAYMENT' && dto.paymentState !== 'paid';
}
