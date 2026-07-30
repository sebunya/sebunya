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

export type CheckoutSagaStage =
  | 'PRICED'
  | 'INVENTORY_RESERVED'
  | 'BLOCKED_STOCK'
  | 'AWAITING_PAYMENT';

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
  complete(lease: LeaseToken, orderId: string): Promise<boolean>;
  fail(lease: LeaseToken, reason: string, retryable: boolean): Promise<boolean>;
  find(identity: string): Promise<IdempotencyRecord | null>;
}
