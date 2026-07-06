import { LoyaltyReason } from '../../domain/loyalty/Loyalty';

export interface LoyaltyLedgerEntry {
  id: string;
  userId: string | null;
  orderId: string | null;
  points: number;
  reason: LoyaltyReason;
  description: string | null;
  createdAt: Date;
}

export interface NewLoyaltyLedgerEntry {
  userId: string | null;
  orderId: string | null;
  points: number;
  reason: LoyaltyReason;
  description: string | null;
}

export interface ILoyaltyLedgerRepository {
  append(entry: NewLoyaltyLedgerEntry): Promise<LoyaltyLedgerEntry>;
  findByOrderAndReason(orderId: string, reason: LoyaltyReason): Promise<LoyaltyLedgerEntry | null>;
  listForUser(userId: string, limit: number): Promise<LoyaltyLedgerEntry[]>;
}

/** Minimal order lookup the loyalty flow needs — kept separate from the
 * commerce repositories so loyalty stays decoupled from order internals. */
export interface LoyaltyOrderTarget {
  orderId: string;
  userId: string | null;
  totalAmount: number;
}

export interface ILoyaltyOrderLookup {
  findLoyaltyTarget(orderId: string): Promise<LoyaltyOrderTarget | null>;
}
