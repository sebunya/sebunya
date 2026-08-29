import { LoyaltyLedgerEntry, LoyaltyProgrammeConfig } from '../../domain/loyalty/LoyaltyLedger';

/**
 * Loyalty completion ports (brief stages 2–4).
 */

export interface LoyaltyRuleRow {
  id: string;
  ruleCode: string;
  version: number;
  earnBasis: string;
  rate: number;
  active: boolean;
}

export interface LoyaltyRedemptionRow {
  id: string;
  accountId: string;
  orderId: string | null;
  pointsReserved: number;
  valueUgx: number;
  pointValueUgx: number;
  status: 'reserved' | 'applied' | 'released' | 'reversed';
  idempotencyKey: string;
  ledgerEntryId: string | null;
  reservedUntil: Date | null;
}

export interface ILoyaltyCompletionRepository {
  getProgrammeConfig(): Promise<LoyaltyProgrammeConfig>;
  getActiveRule(ruleCode: string): Promise<LoyaltyRuleRow | null>;
  /** Sum of all positive earn points ever issued (budget-cap input). */
  lifetimeIssuedPoints(): Promise<number>;
  findEarnEntryForOrder(orderId: string): Promise<LoyaltyLedgerEntry | null>;
  /** Points already clawed back against one earn entry, as a positive number. */
  sumReversedPointsForEntry(earnEntryId: string): Promise<number>;

  createReservation(input: {
    /**
     * Ceiling on this account's TOTAL reserved points, checked inside the same
     * transaction as the insert. Null returned when the reservation would
     * breach it. Without this the balance check and the insert were separate
     * statements, so two concurrent redemptions could both pass the check and
     * reserve the same points twice.
     */
    maxTotalReservedPoints?: number;
    accountId: string;
    orderId: string | null;
    pointsReserved: number;
    valueUgx: number;
    pointValueUgx: number;
    idempotencyKey: string;
    reservedUntil: Date | null;
  }): Promise<LoyaltyRedemptionRow | null>;
  findReservation(id: string): Promise<LoyaltyRedemptionRow | null>;
  findReservationByOrder(orderId: string): Promise<LoyaltyRedemptionRow | null>;
  /** Points currently held by open reservations for the account (they reduce spendable balance). */
  reservedPoints(accountId: string): Promise<number>;
  attachReservationToOrder(reservationId: string, orderId: string): Promise<void>;
  markReservation(
    reservationId: string,
    status: 'applied' | 'released' | 'reversed',
    ledgerEntryId?: string | null,
  ): Promise<boolean>;
  /** Open reservations past their TTL with no order attached — release targets. */
  listExpiredReservations(now: Date): Promise<LoyaltyRedemptionRow[]>;

  listAccountIds(): Promise<Array<{ accountId: string; userId: string }>>;
  /** Earns nearing expiry across all accounts (for warning notices). */
  listEarnsNearingExpiry(withinDays: number, now: Date): Promise<Array<{ entry: LoyaltyLedgerEntry; userId: string }>>;
  noticeAlreadySent(earnEntryId: string, kind: string): Promise<boolean>;
  recordNotice(input: { accountId: string; earnEntryId: string; kind: string; channel: string }): Promise<void>;

  ledgerTotals(): Promise<{
    issued: number;
    redeemed: number;
    expired: number;
    clawedBack: number;
    outstanding: number;
  }>;
  writeLiabilitySnapshot(input: {
    snapshotDate: string;
    pointsOutstanding: number;
    pointsIssued: number;
    pointsRedeemed: number;
    pointsExpired: number;
    pointsClawedBack: number;
    pendingPoints: number;
    pointValueUgx: number | null;
    liabilityUgx: number | null;
    breakageEstimateBps: number | null;
    redemptionRateBps: number | null;
  }): Promise<void>;

  recordFraudSignal(input: {
    accountId?: string | null;
    userId?: string | null;
    signalType: string;
    severity?: 'low' | 'medium' | 'high';
    details?: unknown;
  }): Promise<void>;

  /** Paid orders not yet delivered/completed for a user — the PENDING points projection. */
  pendingEarnOrders(userId: string): Promise<Array<{ orderId: string; totalUgx: number }>>;
}
