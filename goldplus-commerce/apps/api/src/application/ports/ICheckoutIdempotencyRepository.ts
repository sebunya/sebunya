import { IdempotencyRecord } from '../../domain/commerce/CheckoutPrincipal';

/**
 * Proof of ownership for every mutation of a checkout claim.
 *
 * Defined in the application layer, not in the Drizzle repository, so a route can
 * carry a lease without importing infrastructure — the architecture boundary that
 * keeps HTTP thin and swappable.
 *
 * Identity alone is NOT ownership: after a takeover the row is IN_PROGRESS again,
 * so a worker returning late from a slow call would match a state-only predicate
 * and could overwrite its successor's outcome.
 */
export interface LeaseToken {
  identity: string;
  claimToken: string;
  fencingNumber: number;
}

/**
 * Where the checkout saga actually got to.
 *
 * This is NOT the operation's outcome — `operation_state` carries that. The two
 * were previously collapsed, which is how an unpaid order came to be recorded as
 * COMPLETED. Resumption reads this stage, so every stage a resume can start from
 * must be nameable here; the vocabulary matches migration 0059's CHECK constraint
 * exactly, because a stage this type permits but the database rejects would abort
 * the transaction at the moment of recording progress.
 */
export type CheckoutSagaStage =
  | 'CLAIMED'
  | 'PRICED'
  | 'ORDER_CREATED'
  | 'INVENTORY_RESERVED'
  | 'BLOCKED_STOCK'
  | 'FULFILMENT_QUEUED'
  | 'NOTIFICATION_QUEUED'
  | 'PAYMENT_READY'
  | 'PAYMENT_STARTED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_REVIEW'
  | 'ORDER_CONFIRMED'
  | 'COMPLETED'
  /** Retained so pre-0059 rows read back without widening the write path. */
  | 'AWAITING_PAYMENT';

/**
 * Ordered saga positions, used to decide what a resume may skip.
 *
 * Deliberately explicit rather than derived from the union above: the order is a
 * business fact about the saga, and a reordered type declaration must not silently
 * change what a resume re-executes.
 */
export const CHECKOUT_STAGE_ORDER: readonly CheckoutSagaStage[] = [
  'CLAIMED',
  'PRICED',
  'ORDER_CREATED',
  'INVENTORY_RESERVED',
  'FULFILMENT_QUEUED',
  'NOTIFICATION_QUEUED',
  'PAYMENT_READY',
  'PAYMENT_STARTED',
  'PAYMENT_PENDING',
  'ORDER_CONFIRMED',
  'COMPLETED',
];

/**
 * True when the saga has already passed `stage`.
 *
 * Stages outside the linear order (BLOCKED_STOCK, PAYMENT_REVIEW, the legacy
 * AWAITING_PAYMENT) return false: they are branch outcomes, not positions, so a
 * resume from one must re-derive rather than assume progress.
 */
export function stageReached(
  recorded: string | null | undefined,
  stage: CheckoutSagaStage,
): boolean {
  if (!recorded) return false;
  const at = CHECKOUT_STAGE_ORDER.indexOf(recorded as CheckoutSagaStage);
  const target = CHECKOUT_STAGE_ORDER.indexOf(stage);
  if (at < 0 || target < 0) return false;
  return at >= target;
}

export interface ClaimResult {
  claimed: boolean;
  record: IdempotencyRecord;
  /** Present only when this caller actually holds the claim. */
  lease?: LeaseToken;
}

export interface ICheckoutIdempotencyRepository {
  claim(args: {
    identity: string;
    principalKey: string;
    fingerprint: string;
    now?: Date;
  }): Promise<ClaimResult>;
  /** Records the order id the moment the order exists, under the active fence. */
  linkOrder(lease: LeaseToken, orderId: string): Promise<boolean>;
  advanceStage(lease: LeaseToken, stage: CheckoutSagaStage): Promise<boolean>;
  heartbeat(lease: LeaseToken, now?: Date): Promise<boolean>;
  /**
   * Marks the WORKFLOW as no longer running, at whatever stage it reached.
   *
   * Named for what it actually does. The previous `complete()` also overwrote the
   * saga stage with COMPLETED, so an order that had only reached PAYMENT_READY was
   * stored as a completed checkout and its true position was destroyed — both the
   * false-completion bug and the reason a resume could not tell what was still
   * owed. Implementations must NOT overwrite `stage`.
   */
  finishOperation(lease: LeaseToken, orderId: string): Promise<boolean>;
  fail(lease: LeaseToken, reason: string, retryable: boolean): Promise<boolean>;
  find(identity: string): Promise<IdempotencyRecord | null>;
}
