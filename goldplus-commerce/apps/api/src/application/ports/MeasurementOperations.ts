/** Operator view of durable measurement deliveries (0140/0141). No PII crosses this port. */
export type DeliveryState = 'PENDING' | 'LEASED' | 'RETRY_WAIT' | 'ACCEPTED' | 'PROCESSED' | 'UNKNOWN_OUTCOME' | 'SUPPRESSED' | 'QUARANTINED' | 'DEAD_LETTER' | 'CANCELLED';
export const DELIVERY_STATES: readonly DeliveryState[] = ['PENDING', 'LEASED', 'RETRY_WAIT', 'ACCEPTED', 'PROCESSED', 'UNKNOWN_OUTCOME', 'SUPPRESSED', 'QUARANTINED', 'DEAD_LETTER', 'CANCELLED'];
/** States an operator may replay: never one that may already have been accepted without proof. */
export const REPLAYABLE: readonly DeliveryState[] = ['DEAD_LETTER', 'QUARANTINED', 'UNKNOWN_OUTCOME', 'SUPPRESSED'];

export interface DeliveryRow {
  deliveryId: string; eventId: string; eventName: string; orderNumber: string | null; sink: string; state: DeliveryState; reason: string | null;
  attempts: number; replayCount: number; createdAt: string; updatedAt: string; nextAttemptAt: string; acceptedAt: string | null; occurredAt: string;
}
export interface AttemptRow { attemptNo: number; startedAt: string; finishedAt: string | null; outcome: string; httpStatus: number | null; providerCode: string | null }
export interface DeliverySummary {
  byState: Record<string, number>; bySink: Array<{ sink: string; state: string; n: number }>;
  oldestDueMinutes: number | null; unroutedEvents: number; writeFailures: number; eventConflicts: number;
  killSwitch: { on: boolean; reason: string | null; updatedAt: string | null };
  /** `since` is when measurement began recording; before it, orders have no events by design. */
  events: { total: number; last24h: number; since: string | null };
  /** Browser intake health: rejections are how a broken or hostile client shows up. */
  collector: { batches24h: number; acceptedEvents24h: number; rejectedEvents24h: number; touches24h: number };
}
export interface MeasurementOperationsRepository {
  summary(): Promise<DeliverySummary>;
  list(filter: { states?: DeliveryState[]; sink?: string; limit: number; before?: string }): Promise<DeliveryRow[]>;
  get(deliveryId: string): Promise<(DeliveryRow & { attemptsList: AttemptRow[]; event: Record<string, unknown> }) | null>;
  getMany(ids: string[]): Promise<DeliveryRow[]>;
  replay(ids: string[]): Promise<number>;
  setState(ids: string[], from: readonly DeliveryState[], to: 'QUARANTINED' | 'CANCELLED', reason: string): Promise<number>;
  setKillSwitch(on: boolean, reason: string, actorId: string | null): Promise<void>;
}

/** Attribution runs (0141): scheduled bounded batch under the host-wide analytics lease. */
export interface AttributionRunView {
  runId: string; method: string; status: string; inputOrders: number; coveredOrders: number; inputJourneys: number;
  startedAt: string; finishedAt: string | null; diagnostics: Record<string, unknown>;
  channels: Array<{ channel: string; value: number; detail: Record<string, unknown> }>;
}
export interface BatchRunView { runId: string; job: string; state: string; reason: string | null; startedAt: string; finishedAt: string | null; stats: Record<string, unknown> }
export interface AttributionCoverage { businessEvents: number; firstEventAt: string | null; confirmedOrders90d: number }
export interface AttributionPort {
  latest(): Promise<{ runs: AttributionRunView[]; batches: BatchRunView[]; coverage: AttributionCoverage }>;
  /** Runs now if the lease and the host admit it; otherwise records DEFERRED_RESOURCE. */
  runNow(trigger: string): Promise<{ state: string; reason: string | null; batchRunId: string }>;
}
