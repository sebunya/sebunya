/**
 * Daily loyalty control totals and reconciliation.
 *
 * Reconciliation only means something when it compares two things that were
 * produced independently. Because the ledger is append-only (migration 0050) and
 * a snapshot is immutable once written (0051), re-deriving any past business date
 * must reproduce the stored figure forever. A mismatch is therefore proof of
 * tampering, a restore gone wrong, or a defect — never ordinary drift.
 *
 * Nothing here mutates the ledger. Corrections are made by appending compensating
 * entries, which a later date's snapshot reflects.
 */

export type LoyaltyEntryType = 'earn' | 'redeem' | 'reversal' | 'expiry' | 'adjustment';

/** The figures a snapshot freezes for one business date. */
export interface LoyaltyControlTotals {
  businessDate: string;
  entryCount: number;
  earnPoints: number;
  redeemPoints: number;
  reversalPoints: number;
  expiryPoints: number;
  adjustmentPoints: number;
  /** Cumulative signed balance across every entry up to and including the date. */
  closingBalance: number;
  accountsWithBalance: number;
}

/** One ledger row, reduced to what the totals depend on. */
export interface LedgerEntryForTotals {
  accountId: string;
  type: LoyaltyEntryType;
  points: number;
  createdAt: Date;
}

export interface ILoyaltyControlTotalsRepository {
  /** Every entry created on or before the end of the business date, in UTC. */
  entriesUpTo(businessDateEndUtc: Date): Promise<LedgerEntryForTotals[]>;
  findSnapshot(businessDate: string): Promise<LoyaltyControlTotals | null>;
  saveSnapshot(
    totals: LoyaltyControlTotals,
    meta: { computedBy: string; traceId: string },
  ): Promise<LoyaltyControlTotals>;
}

/** Inclusive end of a UTC business date, so "on that day" is unambiguous. */
export function businessDateEndUtc(businessDate: string): Date {
  return new Date(`${businessDate}T23:59:59.999Z`);
}

/**
 * Derives the totals for a business date from ledger entries.
 *
 * Per-type figures cover entries created ON the date; the closing balance is
 * cumulative across everything up to and including it, because liability is a
 * position rather than a flow. Mixing the two is the classic control-total error:
 * a day's movement can be zero while the outstanding liability is large.
 */
export function deriveControlTotals(
  businessDate: string,
  entriesUpToAndIncluding: readonly LedgerEntryForTotals[],
): LoyaltyControlTotals {
  const dayStart = new Date(`${businessDate}T00:00:00.000Z`).getTime();
  const dayEnd = businessDateEndUtc(businessDate).getTime();

  const byType: Record<LoyaltyEntryType, number> = {
    earn: 0,
    redeem: 0,
    reversal: 0,
    expiry: 0,
    adjustment: 0,
  };

  let entryCount = 0;
  let closingBalance = 0;
  const balanceByAccount = new Map<string, number>();

  for (const entry of entriesUpToAndIncluding) {
    const at = entry.createdAt.getTime();
    if (at > dayEnd) continue; // Defensive: the repository already bounds this.

    closingBalance += entry.points;
    balanceByAccount.set(entry.accountId, (balanceByAccount.get(entry.accountId) ?? 0) + entry.points);

    if (at >= dayStart) {
      entryCount += 1;
      byType[entry.type] += entry.points;
    }
  }

  let accountsWithBalance = 0;
  for (const balance of balanceByAccount.values()) {
    if (balance !== 0) accountsWithBalance += 1;
  }

  return {
    businessDate,
    entryCount,
    earnPoints: byType.earn,
    redeemPoints: byType.redeem,
    reversalPoints: byType.reversal,
    expiryPoints: byType.expiry,
    adjustmentPoints: byType.adjustment,
    closingBalance,
    accountsWithBalance,
  };
}

export interface ControlTotalsDifference {
  field: keyof LoyaltyControlTotals;
  stored: number | string;
  derived: number | string;
}

export type ReconciliationResult =
  | { status: 'RECONCILED'; businessDate: string; totals: LoyaltyControlTotals }
  | { status: 'SNAPSHOT_CREATED'; businessDate: string; totals: LoyaltyControlTotals }
  | {
      status: 'DISCREPANCY';
      businessDate: string;
      stored: LoyaltyControlTotals;
      derived: LoyaltyControlTotals;
      differences: ControlTotalsDifference[];
    };

export class ReconcileLoyaltyControlTotalsUseCase {
  constructor(private readonly repo: ILoyaltyControlTotalsRepository) {}

  /**
   * Reconciles one business date. Creates the snapshot if none exists yet;
   * otherwise re-derives and compares.
   *
   * A discrepancy is reported, never corrected. Silently overwriting the stored
   * figure would destroy the only evidence that something changed — which is the
   * entire reason the snapshot is immutable.
   */
  async execute(input: {
    businessDate: string;
    computedBy?: string;
    traceId: string;
  }): Promise<ReconciliationResult> {
    const { businessDate } = input;

    const entries = await this.repo.entriesUpTo(businessDateEndUtc(businessDate));
    const derived = deriveControlTotals(businessDate, entries);

    const stored = await this.repo.findSnapshot(businessDate);
    if (!stored) {
      const saved = await this.repo.saveSnapshot(derived, {
        computedBy: input.computedBy ?? 'system',
        traceId: input.traceId,
      });
      return { status: 'SNAPSHOT_CREATED', businessDate, totals: saved };
    }

    const differences = diffTotals(stored, derived);
    if (differences.length === 0) {
      return { status: 'RECONCILED', businessDate, totals: stored };
    }
    return { status: 'DISCREPANCY', businessDate, stored, derived, differences };
  }
}

function diffTotals(
  stored: LoyaltyControlTotals,
  derived: LoyaltyControlTotals,
): ControlTotalsDifference[] {
  const fields: (keyof LoyaltyControlTotals)[] = [
    'entryCount',
    'earnPoints',
    'redeemPoints',
    'reversalPoints',
    'expiryPoints',
    'adjustmentPoints',
    'closingBalance',
    'accountsWithBalance',
  ];
  const differences: ControlTotalsDifference[] = [];
  for (const field of fields) {
    if (stored[field] !== derived[field]) {
      differences.push({ field, stored: stored[field], derived: derived[field] });
    }
  }
  return differences;
}
