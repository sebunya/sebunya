import { sql } from 'drizzle-orm';
import { db } from '../client';
import type {
  ILoyaltyControlTotalsRepository,
  LedgerEntryForTotals,
  LoyaltyControlTotals,
  LoyaltyEntryType,
} from '../../../application/use-cases/loyalty/ReconcileLoyaltyControlTotalsUseCase';

const rowsOf = (result: unknown): any[] => (Array.isArray(result) ? result : (result as { rows?: any[] })?.rows ?? []);

const toIsoDate = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

const toTotals = (r: any): LoyaltyControlTotals => ({
  businessDate: toIsoDate(r.business_date),
  entryCount: Number(r.entry_count),
  earnPoints: Number(r.earn_points),
  redeemPoints: Number(r.redeem_points),
  reversalPoints: Number(r.reversal_points),
  expiryPoints: Number(r.expiry_points),
  adjustmentPoints: Number(r.adjustment_points),
  closingBalance: Number(r.closing_balance),
  accountsWithBalance: Number(r.accounts_with_balance),
});

/**
 * The frozen daily control totals (0051). A snapshot row is immutable (a
 * trigger refuses UPDATE and DELETE), so saving is insert-if-absent.
 */
export class DrizzleLoyaltyControlTotalsRepository implements ILoyaltyControlTotalsRepository {
  /**
   * The business date's own entries one by one, and everything BEFORE it
   * collapsed in SQL to one opening-position row per account (dated just before
   * the day, so it feeds only the closing balance and the per-account balances,
   * never the day's counts or per-type figures). deriveControlTotals gives the
   * same answer as over the full ledger; loading the full ledger seven times a
   * run grew linearly with every entry ever written.
   */
  async entriesUpTo(businessDateEndUtc: Date): Promise<LedgerEntryForTotals[]> {
    const end = businessDateEndUtc.toISOString();
    const dayStart = new Date(businessDateEndUtc.getTime() - 86_400_000 + 1).toISOString();
    const opening = new Date(businessDateEndUtc.getTime() - 86_400_000).toISOString();
    const rows = rowsOf(
      await db.execute(sql`
        select account_id, 'adjustment'::text as type, sum(points)::bigint as points, ${opening}::timestamptz as created_at
        from loyalty_ledger_entries
        where created_at < ${dayStart}::timestamptz
        group by account_id
        union all
        select account_id, type::text, points::bigint, created_at
        from loyalty_ledger_entries
        where created_at >= ${dayStart}::timestamptz and created_at <= ${end}::timestamptz
      `),
    );
    return rows.map((r) => ({
      accountId: String(r.account_id),
      type: r.type as LoyaltyEntryType,
      points: Number(r.points),
      createdAt: new Date(r.created_at),
    }));
  }

  async findSnapshot(businessDate: string): Promise<LoyaltyControlTotals | null> {
    const [row] = rowsOf(
      await db.execute(sql`select * from loyalty_daily_control_totals where business_date = ${businessDate}::date limit 1`),
    );
    return row ? toTotals(row) : null;
  }

  async saveSnapshot(totals: LoyaltyControlTotals, meta: { computedBy: string; traceId: string }): Promise<LoyaltyControlTotals> {
    await db.execute(sql`
      insert into loyalty_daily_control_totals
        (business_date, entry_count, earn_points, redeem_points, reversal_points, expiry_points,
         adjustment_points, closing_balance, accounts_with_balance, computed_by, trace_id)
      values
        (${totals.businessDate}::date, ${totals.entryCount}, ${totals.earnPoints}, ${totals.redeemPoints},
         ${totals.reversalPoints}, ${totals.expiryPoints}, ${totals.adjustmentPoints}, ${totals.closingBalance},
         ${totals.accountsWithBalance}, ${meta.computedBy.slice(0, 64)}, ${meta.traceId.slice(0, 128)})
      on conflict (business_date) do nothing
    `);
    // A concurrent writer may have won; what is stored is the answer.
    return (await this.findSnapshot(totals.businessDate)) ?? totals;
  }
}
