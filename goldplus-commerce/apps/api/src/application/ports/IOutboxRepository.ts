export interface PersistedOutboxEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  isProcessed: boolean;
  createdAt: Date;
  nextAttemptAt: Date;
}

export interface IOutboxRepository {
  claimDueBatch(now: Date, limit: number): Promise<PersistedOutboxEvent[]>;
  markProcessed(eventId: string, opts?: { lastError?: string }): Promise<void>;
  recordFailure(eventId: string, error: string, nextAttemptAt: Date): Promise<void>;
}
