import { Order } from '../../domain/commerce/Order';
import { OrderReservationState, mayProgressToPayment } from '../../domain/inventory/Inventory';

/**
 * The public checkout response.
 *
 * The route previously did `{ ...result.order }`, spreading the whole domain
 * order into JSON. That object carries the customer's full name, phone number,
 * email address and delivery address, plus every line item. On the idempotent
 * replay path that response was returned for a key the caller supplied — so
 * whatever the caller could get the lookup to match, they received in full.
 *
 * Scoping the key to a trusted principal closes who can reach a replay. This
 * closes what a replay can hand back, which is the other half: an allowlist
 * built by naming fields, not a domain object with fields removed. A subtractive
 * approach silently re-exposes anything later added to the entity.
 *
 * Contact details are deliberately absent even for the legitimate owner. The
 * caller just submitted them; echoing them back adds nothing and puts PII in
 * every proxy log and browser cache along the way. The authenticated
 * account order-detail route serves the customer's own full view, after
 * object-level authorization.
 */

export type CheckoutNextAction =
  | 'AWAIT_PAYMENT'
  | 'AWAIT_STOCK_CONFIRMATION'
  | 'CONTACT_SUPPORT'
  | 'NONE';

export interface CheckoutResponseDto {
  orderId: string;
  orderNumber: string;
  checkoutState: string;
  paymentState: string;
  reservationState: OrderReservationState;
  deliveryFeeConfirmed: boolean;
  totalAmount: number;
  currency: string;
  nextAction: CheckoutNextAction;
  idempotentReplay: boolean;
}

export function toCheckoutResponseDto(input: {
  order: Order;
  reservationState: OrderReservationState;
  deliveryFeeConfirmed: boolean;
  idempotentReplay: boolean;
}): CheckoutResponseDto {
  const { order, reservationState } = input;

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    checkoutState: order.orderStatus,
    paymentState: order.paymentStatus,
    reservationState,
    deliveryFeeConfirmed: input.deliveryFeeConfirmed,
    // The total is included because the customer is about to be asked to pay it
    // and needs to see it. It is the server's figure, never the client's.
    totalAmount: order.totalUgx,
    currency: order.pricingSnapshot?.currency ?? 'UGX',
    nextAction: nextActionFor(reservationState, order.paymentStatus),
    idempotentReplay: input.idempotentReplay,
  };
}

/**
 * What the client should do next, decided from the same canonical reservation
 * state that gates payment and fulfilment.
 *
 * Derived rather than sent, so the client cannot be told to collect payment for
 * an order the server considers unpayable.
 */
function nextActionFor(
  reservationState: OrderReservationState,
  paymentState: string,
): CheckoutNextAction {
  if (paymentState === 'paid') return 'NONE';
  if (!mayProgressToPayment(reservationState)) {
    return reservationState === 'UNRESERVED_BLOCKED' ? 'CONTACT_SUPPORT' : 'AWAIT_STOCK_CONFIRMATION';
  }
  return 'AWAIT_PAYMENT';
}
