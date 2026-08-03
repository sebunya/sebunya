import { OrderStatus, PaymentStatus } from '../../domain/commerce/Order';

/**
 * Port for the ONE canonical order-status transition path (P0-2).
 *
 * Application use cases depend on THIS interface, never on the concrete
 * infrastructure service, so the hexagonal boundary holds: the use case knows
 * only that "a transition is applied atomically and recorded exactly once".
 */

export type OrderActorType =
  | 'customer'
  | 'administrator'
  | 'system'
  | 'payment_provider'
  | 'fulfilment_worker';

export type OrderEventSource = 'admin_api' | 'payment' | 'fulfilment' | 'customer' | 'system';

export interface OrderTransitionContext {
  /** Actor identity — ALWAYS from the authenticated session / verified provider, never a request body. */
  actorId?: string | null;
  actorType: OrderActorType;
  source: OrderEventSource;
  reasonCode?: string;
  note?: string;
  /**
   * Authoritative payment status to commit atomically WITH this lifecycle
   * transition (e.g. a verified payment result). When set it is also used as the
   * state-machine gate value, since the provider's verified result — not the
   * stale stored value — authorises the move. Omit for non-payment transitions.
   * `'reversed'` is a stored payment state the narrower domain PaymentStatus does
   * not model; it gates as "not paid", which is correct.
   */
  paymentStatus?: PaymentStatus | 'reversed';
  /** Stable external identity of the transition; makes retries produce no duplicate event. */
  idempotencyKey?: string | null;
  correlationId?: string | null;
}

export interface OrderTransitionResult {
  orderId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  eventId: string;
  idempotentReplay: boolean;
}

export interface OrderEventRecord {
  id: string;
  orderId: string;
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  actorType: string;
  reasonCode: string | null;
  source: string;
  note: string | null;
  isSynthetic: boolean;
  occurredAt: Date;
}

export interface IOrderTransitionPort {
  /**
   * Apply `orderId: from → toStatus` atomically: validate via the canonical
   * OrderStateMachine, update the status (and optionally payment status) and
   * append EXACTLY ONE order_event, all in one transaction. An illegal
   * transition commits nothing. A retry with a stable idempotencyKey returns the
   * already-committed event instead of writing a duplicate.
   */
  transition(orderId: string, toStatus: OrderStatus, ctx: OrderTransitionContext): Promise<OrderTransitionResult>;
  /** Bounded, most-recent-first, read-only history for one order. */
  history(orderId: string, limit?: number): Promise<OrderEventRecord[]>;
}
