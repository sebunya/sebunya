import type { AssistantConfig, Usage } from '../../domain/assistant/AssistantPolicy';

export type LedgerStatus = 'RESERVED' | 'SETTLED' | 'RELEASED' | 'UNKNOWN';

export interface LedgerRow {
  id: string;
  month: string;
  status: LedgerStatus;
  reservedMicroUsd: number;
  settledMicroUsd: number | null;
  model: string;
  principalHash: string;
  conversationId: string | null;
  outcome: string | null;
  createdAt: Date;
  settledAt: Date | null;
}

export interface MonthTotals {
  month: string;
  settledMicroUsd: number;
  /** RESERVED plus UNKNOWN: money that may still be billed. */
  reservedMicroUsd: number;
  counts: Record<LedgerStatus, number>;
  outcomes: Record<string, number>;
}

export interface IAssistantLedgerRepository {
  /**
   * Atomically: expire stale RESERVED rows to UNKNOWN, read the month's committed
   * total, and insert a RESERVED row only if committed + amount <= kill. Returns
   * null when refused. Serialised per month so concurrent callers cannot both fit
   * into the last cents.
   */
  reserve(input: { month: string; amountMicroUsd: number; killThresholdMicroUsd: number; model: string; principalHash: string; conversationId: string | null; staleAfterMs: number }): Promise<{ id: string; settledBefore: number } | null>;
  settle(input: { id: string; usage: Usage; costMicroUsd: number; providerRequestId: string | null; outcome: string }): Promise<{ settledAfter: number } | null>;
  release(input: { id: string; reason: string }): Promise<boolean>;
  totals(month: string): Promise<MonthTotals>;
  recent(month: string, limit: number): Promise<LedgerRow[]>;
}

export interface IAssistantConfigRepository {
  get(): Promise<{ config: AssistantConfig; version: number } | null>;
  save(config: AssistantConfig, expectedVersion: number, actorId: string): Promise<{ version: number } | null>;
}

/** A sliding-window counter shared by every API replica (Redis in production). */
export interface IAssistantCounterStore {
  consume(control: string, identity: string, limit: { limit: number; windowMs: number }): Promise<{ count: number; degraded: boolean }>;
}
