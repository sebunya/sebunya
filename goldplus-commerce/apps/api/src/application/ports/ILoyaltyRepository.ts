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
  | { ok: false; code: 'INSUFFICIENT_BALANCE' | 'IDEMPOTENCY_CONFLICT' | 'ACCOUNT_MERGED'; available?: number };

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
  /**
   * `expireDue: false` skips the lazy expiry that normally runs first: while
   * redemption is paused no points may expire (loyalty terms, section 4), and
   * a debit posted during the pause must not expire them on the side.
   */
  appendDebitIfAvailable(input: AppendEntryInput, now: Date, options?: { expireDue?: boolean }): Promise<DebitResult>;
  /**
   * The survivor this account was merged into, or null. A merged account's
   * points are spent from the survivor only: its entries already count there.
   */
  mergedInto(accountId: string): Promise<string | null>;
  expireDue(accountId: string, now: Date): Promise<LoyaltyLedgerEntry[]>;
  reverseEntry(entryId: string, reason: string): Promise<ReverseEntryResult>;
  getOperationsSnapshot(input: { now: Date; limit: number }): Promise<LoyaltyOperationsSnapshot>;
  getConfig(): Promise<LoyaltyConfig>;
  saveConfig(config: LoyaltyConfig): Promise<LoyaltyConfig>;
}
