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
}

export interface ILoyaltyRepository {
  getOrCreateAccount(userId: string): Promise<{ id: string; userId: string }>;
  listEntries(accountId: string): Promise<LoyaltyLedgerEntry[]>;
  findEntryById(entryId: string): Promise<LoyaltyLedgerEntry | null>;
  /** Returns the existing entry when the idempotency key was already used. */
  append(input: AppendEntryInput): Promise<{ entry: LoyaltyLedgerEntry; replay: boolean }>;
  getConfig(): Promise<LoyaltyConfig>;
  saveConfig(config: LoyaltyConfig): Promise<LoyaltyConfig>;
}
