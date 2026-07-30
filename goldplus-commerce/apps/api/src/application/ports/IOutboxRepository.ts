export interface PersistedOutboxEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  isProcessed: boolean;
  createdAt: Date;
  nextAttemptAt: Date;
  idempotencyKey?: string | null;
  channel?: string | null;
  template?: string | null;
  status: string;
  relatedEntity?: string | null;
  relatedEntityId?: string | null;
  dryRunOnly: boolean;
  previewOnly: boolean;
  noSendGuarantee: boolean;
  suppressedReason?: string | null;
  lastError?: string | null;
}

/**
 * Which event types a worker is willing to claim.
 *
 * The outbox carries two unrelated kinds of work: outbound messages, which route
 * to a provider, and units of commerce work, which do not. A worker that claims
 * everything and then finds no route for an event marks it processed as
 * "unroutable" — indistinguishable from a success, and the work is gone. Claiming
 * has to be selective for the two kinds to coexist in one table.
 */
export interface OutboxClaimFilter {
  includeEventTypes?: readonly string[];
  excludeEventTypes?: readonly string[];
}

export interface IOutboxRepository {
  claimDueBatch(
    now: Date,
    limit: number,
    filter?: OutboxClaimFilter,
  ): Promise<PersistedOutboxEvent[]>;
  /**
   * Completion is guarded by the claiming worker's lease. `false` means this
   * worker no longer owns the event — its lease expired and another worker took
   * over — and nothing was written. Writing regardless would let a stale worker
   * overwrite its successor's outcome, including turning a delivered event back
   * into a pending one and sending it twice.
   */
  markProcessed(eventId: string, opts?: { lastError?: string }): Promise<boolean | void>;
  recordFailure(eventId: string, error: string, nextAttemptAt: Date): Promise<boolean | void>;
  /**
   * Terminal failure after the retry bound. Distinct from markProcessed because
   * the event was never delivered, and recording it as processed made it
   * indistinguishable from a success in every metric and query.
   */
  markDeadLettered?(eventId: string, error: string): Promise<boolean | void>;
  /** Operational counts, read from status rather than the processed boolean. */
  metrics?(now?: Date): Promise<{
    pending: number;
    due: number;
    processing: number;
    deadLettered: number;
    oldestPendingAgeSeconds: number | null;
    expiredLeases: number;
  }>;
  listDeadLettered?(limit?: number): Promise<PersistedOutboxEvent[]>;
  replayDeadLettered?(eventId: string): Promise<boolean | void>;
  findByRelatedEntity(entity: string, entityId: string): Promise<PersistedOutboxEvent[]>;
  /**
   * Idempotently enqueue an admin-order-email intent. Returns enqueued=false when
   * an intent with the same idempotency key already exists (no duplicate).
   */
  enqueueAdminOrderEmail(input: {
    idempotencyKey: string;
    payload: Record<string, unknown>;
    relatedEntityId: string;
  }): Promise<{ enqueued: boolean }>;
  findById(eventId: string): Promise<PersistedOutboxEvent | null>;
  /** List events of a given type, newest first (admin surface). */
  listByEventType(eventType: string, limit: number): Promise<PersistedOutboxEvent[]>;
  /**
   * Manual replay: requeue a failed/dead-letter event for immediate processing.
   * Returns false if the event is not eligible (e.g. already sent/processed).
   */
  requeueForReplay(eventId: string, now: Date): Promise<boolean>;
}
