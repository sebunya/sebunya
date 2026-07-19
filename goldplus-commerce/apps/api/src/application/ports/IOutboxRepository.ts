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

export interface IOutboxRepository {
  claimDueBatch(now: Date, limit: number): Promise<PersistedOutboxEvent[]>;
  markProcessed(eventId: string, opts?: { lastError?: string }): Promise<void>;
  recordFailure(eventId: string, error: string, nextAttemptAt: Date): Promise<void>;
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
