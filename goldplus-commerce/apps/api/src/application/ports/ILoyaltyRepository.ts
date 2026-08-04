import { LoyaltyLedgerEntry, LoyaltyConfig, LoyaltyEntryType } from '../../domain/loyalty/LoyaltyLedger';

export interface AppendEntryInput {
  accountId: string;
  type: LoyaltyEntryType;
  points: number;
  orderId: string | null;
  reason: string;
  idempotencyKey: string;
  expiresAt: Date | null;
  reversedEntryId: string | null;
  /** 0085: the rule version that granted the entry (append-only provenance). */
  ruleCode?: string | null;
  ruleVersion?: number | null;
}

export type DebitResult =
  | { ok: true; entry: LoyaltyLedgerEntry; replay: boolean; expired: LoyaltyLedgerEntry[] }
  | { ok: false; code: 'INSUFFICIENT_BALANCE' | 'IDEMPOTENCY_CONFLICT'; available?: number };

export type ReverseEntryResult =
  | { ok: true; entry: LoyaltyLedgerEntry; replay: boolean }
  | { ok: false; code: 'NOT_FOUND' | 'NON_REVERSIBLE' | 'ALREADY_REVERSED' | 'IDEMPOTENCY_CONFLICT' };

export interface LoyaltyOperationsSnapshot {
  accountCount: number;
  entryCount: number;
  signedBalance: number;
  pendingExpiry: number;
  byType: Record<LoyaltyEntryType, number>;
  recentEntries: LoyaltyLedgerEntry[];
}

export interface ILoyaltyRepository {
  findAccountByUserId(userId: string): Promise<{ id: string; userId: string } | null>;
  getOrCreateAccount(userId: string): Promise<{ id: string; userId: string }>;
  listEntries(accountId: string): Promise<LoyaltyLedgerEntry[]>;
  findEntryById(entryId: string): Promise<LoyaltyLedgerEntry | null>;
  findEntryByIdempotencyKey(idempotencyKey: string): Promise<LoyaltyLedgerEntry | null>;
  /** Returns the existing entry when the idempotency key was already used. */
  append(input: AppendEntryInput): Promise<{ entry: LoyaltyLedgerEntry; replay: boolean }>;
  appendDebitIfAvailable(input: AppendEntryInput, now: Date): Promise<DebitResult>;
  expireDue(accountId: string, now: Date): Promise<LoyaltyLedgerEntry[]>;
  reverseEntry(entryId: string, reason: string): Promise<ReverseEntryResult>;
  getOperationsSnapshot(input: { now: Date; limit: number }): Promise<LoyaltyOperationsSnapshot>;
  getConfig(): Promise<LoyaltyConfig>;
  saveConfig(config: LoyaltyConfig): Promise<LoyaltyConfig>;
}
