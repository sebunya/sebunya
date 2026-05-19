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
}

export interface IOutboxRepository {
  claimDueBatch(now: Date, limit: number): Promise<PersistedOutboxEvent[]>;
  markProcessed(eventId: string, opts?: { lastError?: string }): Promise<void>;
  recordFailure(eventId: string, error: string, nextAttemptAt: Date): Promise<void>;
  findByRelatedEntity(entity: string, entityId: string): Promise<PersistedOutboxEvent[]>;
}
