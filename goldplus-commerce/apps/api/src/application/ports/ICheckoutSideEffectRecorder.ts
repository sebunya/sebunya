/**
 * Durable side-effect recording.
 *
 * The previous `durably()` helper was not durable: it ran the work inside the
 * request, reported a failure to an observer, and let the checkout carry on.
 * Reporting is evidence, not durability — if the process died after the order
 * committed, the work was simply gone and the operator had an order with no task
 * and no record that a task was ever owed.
 *
 * A side effect is now recorded against a unique (checkout identity, event type)
 * key, so "was this already queued?" is a fact rather than an inference, and the
 * checkout may only advance once the record exists.
 */

export type CheckoutSideEffectType =
  | 'ORDER_FULFILMENT_REQUIRED'
  | 'ORDER_ADMIN_NOTIFICATION_REQUIRED'
  | 'ORDER_CUSTOMER_NOTIFICATION_ELIGIBLE'
  | 'ORDER_PAYMENT_INITIATION_REQUIRED'
  | 'ORDER_PAYMENT_VERIFICATION_REQUIRED'
  | 'ORDER_LOYALTY_ELIGIBILITY_RECORDED'
  | 'ORDER_MEASUREMENT_ELIGIBILITY_RECORDED';

/**
 * The commerce-work event types, as a value.
 *
 * Needed at runtime to partition the outbox: these events are units of commerce
 * work, not outbound messages, and the notification worker claims every due event
 * regardless of type. Left unpartitioned it would claim these, find no channel
 * mapping, and mark them processed as "unroutable" — silently discarding the
 * fulfilment task the customer's order depends on while reporting success.
 */
export const CHECKOUT_SIDE_EFFECT_EVENT_TYPES: readonly CheckoutSideEffectType[] = [
  'ORDER_FULFILMENT_REQUIRED',
  'ORDER_ADMIN_NOTIFICATION_REQUIRED',
  'ORDER_CUSTOMER_NOTIFICATION_ELIGIBLE',
  'ORDER_PAYMENT_INITIATION_REQUIRED',
  'ORDER_PAYMENT_VERIFICATION_REQUIRED',
  'ORDER_LOYALTY_ELIGIBILITY_RECORDED',
  'ORDER_MEASUREMENT_ELIGIBILITY_RECORDED',
];

export type SideEffectOutcome =
  /** Newly written. Safe to advance. */
  | 'DURABLY_RECORDED'
  /** A previous attempt already wrote it. Safe to advance, do NOT redo the work. */
  | 'ALREADY_RECORDED'
  /** Transient. The checkout must not advance; a retry may succeed. */
  | 'RETRYABLE_FAILURE'
  /** Non-transient. The checkout must not advance. */
  | 'FINAL_FAILURE';

export interface ICheckoutSideEffectRecorder {
  /**
   * Records the intent to perform a side effect, durably and idempotently.
   *
   * Implementations must write the identity row and the outbox event in ONE
   * transaction: an identity with no event would suppress the work forever, and
   * an event with no identity could be duplicated by a retry.
   */
  record(args: {
    checkoutIdentity: string;
    orderId: string;
    eventType: CheckoutSideEffectType;
    policyVersion: string;
    payload: Record<string, unknown>;
    traceId: string;
  }): Promise<SideEffectOutcome>;

  /** Which side effects already exist for this checkout. */
  recordedTypes(checkoutIdentity: string): Promise<CheckoutSideEffectType[]>;
}
