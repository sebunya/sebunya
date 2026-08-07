/**
 * The refund ledger port (production closure, 2026-08-07).
 *
 * ONE owner of "how much of this payment has already been given back". Before
 * this existed the only guard was `amount <= collected`, measured against the
 * ORIGINAL collected amount, so two 60% refunds both passed and 120% of the
 * money could leave. The balance is now arithmetic over recorded rows, taken
 * under a row lock, so concurrent requests cannot both see the same headroom.
 */

export interface RefundLineAllocation {
  orderItemId: string;
  amountUgx: number;
}

export interface RecordedRefund {
  id: string;
  paymentAttemptId: string;
  orderId: string;
  idempotencyKey: string;
  amountUgx: number;
  reason: string;
  status: 'requested' | 'settled' | 'rejected';
  providerStatus: string | null;
  providerMessage: string | null;
  createdAt: Date;
}

export type ReserveRefundOutcome =
  /** The caller now holds the reservation and must call the provider. */
  | { outcome: 'RESERVED'; refund: RecordedRefund }
  /** This idempotency key was already used; nothing was reserved, nothing must be sent. */
  | { outcome: 'ALREADY_PROCESSED'; refund: RecordedRefund }
  /** The amount exceeds what remains refundable on this attempt. */
  | { outcome: 'EXCEEDS_REFUNDABLE_BALANCE'; collectedUgx: number; alreadyRefundedUgx: number; refundableUgx: number }
  /** A line allocation did not belong to this order, or over-allocated a line. */
  | { outcome: 'INVALID_LINE_ALLOCATION'; message: string };

export interface IRefundLedgerRepository {
  /**
   * Atomically: lock the attempt, re-read every non-rejected refund against it,
   * verify the requested amount fits in the remaining balance, verify any line
   * allocation belongs to the order and does not exceed that line's remaining
   * refundable value, and insert the 'requested' row.
   *
   * Returns ALREADY_PROCESSED (without inserting) when the idempotency key has
   * been seen, so a retry never produces a second payout.
   */
  reserveRefund(input: {
    paymentAttemptId: string;
    orderId: string;
    collectedUgx: number;
    idempotencyKey: string;
    amountUgx: number;
    reason: string;
    requestedBy: string;
    lines: RefundLineAllocation[];
  }): Promise<ReserveRefundOutcome>;

  /** Record what the provider said about a reservation we already hold. */
  recordProviderOutcome(refundId: string, update: {
    status: 'requested' | 'settled' | 'rejected';
    providerStatus?: string | null;
    providerMessage?: string | null;
  }): Promise<void>;

  /** Refunded totals for an attempt, excluding rejected rows. */
  getRefundedTotalUgx(paymentAttemptId: string): Promise<number>;

  /**
   * Is there a refund on this attempt still waiting on the provider?
   *
   * Verification returns early for an already-completed attempt, which is
   * correct idempotency for a duplicate callback — but it also meant the
   * provider was never asked again, so a reversal could never be observed and
   * the completed→reversed edge the state machine declares was unreachable.
   * An outstanding refund is the one reason to look again.
   */
  hasOutstandingRefunds(paymentAttemptId: string): Promise<boolean>;

  /**
   * The provider has confirmed the reversal: move every outstanding
   * 'requested' refund on this attempt to 'settled'.
   *
   * Nothing wrote 'settled' before this existed — the completed→reversed edge
   * had no writer at all, so a refund that actually landed left the ledger
   * saying it was still in flight forever. Returns how many rows settled.
   */
  settleRefundsForAttempt(paymentAttemptId: string): Promise<number>;

  listRefundsForOrder(orderId: string): Promise<RecordedRefund[]>;
}
