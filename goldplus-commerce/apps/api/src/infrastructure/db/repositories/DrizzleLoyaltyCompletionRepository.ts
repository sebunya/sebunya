import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import {
  loyaltyAccounts,
  loyaltyConfig,
  loyaltyExpiryNotices,
  loyaltyFraudSignals,
  loyaltyLedgerEntries,
  loyaltyLiabilitySnapshots,
  loyaltyRedemptions,
  loyaltyRules,
} from '../schema/loyalty';
import {
  ILoyaltyCompletionRepository,
  LoyaltyRedemptionRow,
  LoyaltyRuleRow,
} from '../../../application/ports/ILoyaltyCompletion';
import { LoyaltyLedgerEntry, LoyaltyProgrammeConfig } from '../../../domain/loyalty/LoyaltyLedger';

function toEntry(row: typeof loyaltyLedgerEntries.$inferSelect): LoyaltyLedgerEntry {
  return {
    id: row.id,
    accountId: row.accountId,
    type: row.type as LoyaltyLedgerEntry['type'],
    points: row.points,
    orderId: row.orderId,
    reason: row.reason,
    idempotencyKey: row.idempotencyKey,
    expiresAt: row.expiresAt,
    reversedEntryId: row.reversedEntryId,
    createdAt: row.createdAt,
  };
}

function toRedemption(row: typeof loyaltyRedemptions.$inferSelect): LoyaltyRedemptionRow {
  return {
    id: row.id,
    accountId: row.accountId,
    orderId: row.orderId,
    pointsReserved: row.pointsReserved,
    valueUgx: row.valueUgx,
    pointValueUgx: row.pointValueUgx,
    status: row.status as LoyaltyRedemptionRow['status'],
    idempotencyKey: row.idempotencyKey,
    ledgerEntryId: row.ledgerEntryId,
    reservedUntil: row.reservedUntil,
  };
}

export class DrizzleLoyaltyCompletionRepository implements ILoyaltyCompletionRepository {
  async getProgrammeConfig(): Promise<LoyaltyProgrammeConfig> {
    const row = await db.query.loyaltyConfig.findFirst();
    return {
      enabled: row?.enabled ?? false,
      earnRatePer1000Ugx: row?.earnRatePer1000Ugx ?? 0,
      expiryDays: row?.expiryDays ?? 0,
      pointValueUgx: row?.pointValueUgx ?? null,
      redemptionMinPoints: row?.redemptionMinPoints ?? null,
      redemptionMaxShareBps: row?.redemptionMaxShareBps ?? null,
      budgetCapPoints: row?.budgetCapPoints ?? null,
      killSwitch: row?.killSwitch ?? false,
      guestBackfillLookbackDays: row?.guestBackfillLookbackDays ?? null,
      guestBackfillCapPoints: row?.guestBackfillCapPoints ?? null,
      referralReferrerPoints: row?.referralReferrerPoints ?? null,
      referralRefereePoints: row?.referralRefereePoints ?? null,
      birthdayPoints: row?.birthdayPoints ?? null,
      streakTargetOrders: row?.streakTargetOrders ?? null,
      streakWindowDays: row?.streakWindowDays ?? null,
      streakRewardPoints: row?.streakRewardPoints ?? null,
      chanceEnabled: row?.chanceEnabled ?? false,
      termsVersion: row?.termsVersion ?? null,
    };
  }

  async getActiveRule(ruleCode: string): Promise<LoyaltyRuleRow | null> {
    const row = await db.query.loyaltyRules.findFirst({
      where: and(eq(loyaltyRules.ruleCode, ruleCode), eq(loyaltyRules.active, true)),
      orderBy: (r, { desc }) => [desc(r.version)],
    });
    return row
      ? { id: row.id, ruleCode: row.ruleCode, version: row.version, earnBasis: row.earnBasis, rate: row.rate, active: row.active }
      : null;
  }

  async lifetimeIssuedPoints(): Promise<number> {
    const [row] = (await db.execute(sql`
      select coalesce(sum(points), 0)::bigint as issued from loyalty_ledger_entries where type = 'earn'`)) as unknown as Array<{ issued: string | number }>;
    return Number(row?.issued ?? 0);
  }

  async findEarnEntryForOrder(orderId: string): Promise<LoyaltyLedgerEntry | null> {
    const row = await db.query.loyaltyLedgerEntries.findFirst({
      where: and(eq(loyaltyLedgerEntries.orderId, orderId), eq(loyaltyLedgerEntries.type, 'earn')),
    });
    return row ? toEntry(row) : null;
  }

  async createReservation(input: {
    accountId: string;
    orderId: string | null;
    pointsReserved: number;
    valueUgx: number;
    pointValueUgx: number;
    idempotencyKey: string;
    reservedUntil: Date | null;
  }): Promise<LoyaltyRedemptionRow> {
    const [row] = await db
      .insert(loyaltyRedemptions)
      .values({
        accountId: input.accountId,
        orderId: input.orderId,
        pointsReserved: input.pointsReserved,
        valueUgx: input.valueUgx,
        pointValueUgx: input.pointValueUgx,
        idempotencyKey: input.idempotencyKey,
        reservedUntil: input.reservedUntil,
      })
      .onConflictDoNothing({ target: loyaltyRedemptions.idempotencyKey })
      .returning();
    if (row) return toRedemption(row);
    const existing = await db.query.loyaltyRedemptions.findFirst({
      where: eq(loyaltyRedemptions.idempotencyKey, input.idempotencyKey),
    });
    return toRedemption(existing!);
  }

  async findReservation(id: string): Promise<LoyaltyRedemptionRow | null> {
    const row = await db.query.loyaltyRedemptions.findFirst({ where: eq(loyaltyRedemptions.id, id) });
    return row ? toRedemption(row) : null;
  }

  async findReservationByOrder(orderId: string): Promise<LoyaltyRedemptionRow | null> {
    const row = await db.query.loyaltyRedemptions.findFirst({
      where: eq(loyaltyRedemptions.orderId, orderId),
      orderBy: (r, { desc }) => [desc(r.createdAt)],
    });
    return row ? toRedemption(row) : null;
  }

  async reservedPoints(accountId: string): Promise<number> {
    const [row] = (await db.execute(sql`
      select coalesce(sum(points_reserved), 0)::bigint as reserved
      from loyalty_redemptions where account_id = ${accountId} and status = 'reserved'`)) as unknown as Array<{ reserved: string | number }>;
    return Number(row?.reserved ?? 0);
  }

  async attachReservationToOrder(reservationId: string, orderId: string): Promise<void> {
    await db
      .update(loyaltyRedemptions)
      .set({ orderId, updatedAt: new Date() })
      .where(and(eq(loyaltyRedemptions.id, reservationId), eq(loyaltyRedemptions.status, 'reserved')));
  }

  async markReservation(reservationId: string, status: 'applied' | 'released' | 'reversed', ledgerEntryId?: string | null): Promise<boolean> {
    const rows = await db
      .update(loyaltyRedemptions)
      .set({ status, updatedAt: new Date(), ...(ledgerEntryId !== undefined ? { ledgerEntryId } : {}) })
      .where(eq(loyaltyRedemptions.id, reservationId))
      .returning();
    return rows.length > 0;
  }

  async listExpiredReservations(now: Date): Promise<LoyaltyRedemptionRow[]> {
    const rows = await db.query.loyaltyRedemptions.findMany({
      where: and(eq(loyaltyRedemptions.status, 'reserved'), isNull(loyaltyRedemptions.orderId), lt(loyaltyRedemptions.reservedUntil, now)),
    });
    return rows.map(toRedemption);
  }

  async listAccountIds(): Promise<Array<{ accountId: string; userId: string }>> {
    const rows = await db.query.loyaltyAccounts.findMany();
    return rows.map((r) => ({ accountId: r.id, userId: r.userId }));
  }

  async listEarnsNearingExpiry(withinDays: number, now: Date): Promise<Array<{ entry: LoyaltyLedgerEntry; userId: string }>> {
    const horizon = new Date(now.getTime() + withinDays * 24 * 3600 * 1000);
    const rows = (await db.execute(sql`
      select e.*, a.user_id
      from loyalty_ledger_entries e
      join loyalty_accounts a on a.id = e.account_id
      where e.type = 'earn' and e.expires_at is not null
        and e.expires_at > ${now} and e.expires_at <= ${horizon}
        and not exists (select 1 from loyalty_ledger_entries r where r.type in ('reversal','expiry') and r.reversed_entry_id = e.id)`)) as unknown as Array<
      Record<string, unknown> & { user_id: string }
    >;
    return rows.map((r) => ({
      userId: r.user_id,
      entry: {
        id: r.id as string,
        accountId: r.account_id as string,
        type: 'earn',
        points: Number(r.points),
        orderId: (r.order_id as string) ?? null,
        reason: r.reason as string,
        idempotencyKey: r.idempotency_key as string,
        expiresAt: new Date(r.expires_at as string),
        reversedEntryId: null,
        createdAt: new Date(r.created_at as string),
      },
    }));
  }

  async noticeAlreadySent(earnEntryId: string, kind: string): Promise<boolean> {
    const row = await db.query.loyaltyExpiryNotices.findFirst({
      where: and(eq(loyaltyExpiryNotices.earnEntryId, earnEntryId), eq(loyaltyExpiryNotices.noticeKind, kind)),
    });
    return Boolean(row);
  }

  async recordNotice(input: { accountId: string; earnEntryId: string; kind: string; channel: string }): Promise<void> {
    await db
      .insert(loyaltyExpiryNotices)
      .values({ accountId: input.accountId, earnEntryId: input.earnEntryId, noticeKind: input.kind, channel: input.channel })
      .onConflictDoNothing();
  }

  async ledgerTotals() {
    const [row] = (await db.execute(sql`
      select
        coalesce(sum(points) filter (where type = 'earn'), 0)::bigint as issued,
        coalesce(sum(-points) filter (where type = 'redeem'), 0)::bigint as redeemed,
        coalesce(sum(-points) filter (where type = 'expiry'), 0)::bigint as expired,
        coalesce(sum(-points) filter (where type = 'reversal' and points < 0), 0)::bigint as clawed,
        coalesce(sum(points), 0)::bigint as outstanding
      from loyalty_ledger_entries`)) as unknown as Array<{ issued: unknown; redeemed: unknown; expired: unknown; clawed: unknown; outstanding: unknown }>;
    return {
      issued: Number(row?.issued ?? 0),
      redeemed: Number(row?.redeemed ?? 0),
      expired: Number(row?.expired ?? 0),
      clawedBack: Number(row?.clawed ?? 0),
      outstanding: Number(row?.outstanding ?? 0),
    };
  }

  async writeLiabilitySnapshot(input: {
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
  }): Promise<void> {
    await db
      .insert(loyaltyLiabilitySnapshots)
      .values({
        snapshotDate: input.snapshotDate,
        pointsOutstanding: input.pointsOutstanding,
        pointsIssued: input.pointsIssued,
        pointsRedeemed: input.pointsRedeemed,
        pointsExpired: input.pointsExpired,
        pointsClawedBack: input.pointsClawedBack,
        pendingPoints: input.pendingPoints,
        pointValueUgx: input.pointValueUgx,
        liabilityUgx: input.liabilityUgx,
        breakageEstimateBps: input.breakageEstimateBps,
        redemptionRateBps: input.redemptionRateBps,
      })
      .onConflictDoUpdate({
        target: loyaltyLiabilitySnapshots.snapshotDate,
        set: {
          pointsOutstanding: input.pointsOutstanding,
          pointsIssued: input.pointsIssued,
          pointsRedeemed: input.pointsRedeemed,
          pointsExpired: input.pointsExpired,
          pointsClawedBack: input.pointsClawedBack,
          pendingPoints: input.pendingPoints,
          pointValueUgx: input.pointValueUgx,
          liabilityUgx: input.liabilityUgx,
          breakageEstimateBps: input.breakageEstimateBps,
          redemptionRateBps: input.redemptionRateBps,
        },
      });
  }

  async recordFraudSignal(input: {
    accountId?: string | null;
    userId?: string | null;
    signalType: string;
    severity?: 'low' | 'medium' | 'high';
    details?: unknown;
  }): Promise<void> {
    await db.insert(loyaltyFraudSignals).values({
      accountId: input.accountId ?? null,
      userId: input.userId ?? null,
      signalType: input.signalType,
      severity: input.severity ?? 'medium',
      details: input.details ?? null,
    });
  }

  async pendingEarnOrders(userId: string): Promise<Array<{ orderId: string; totalUgx: number }>> {
    const rows = (await db.execute(sql`
      select id, total_amount
      from orders
      where user_id = ${userId}
        and payment_status = 'paid'
        and status in ('received', 'processing', 'dispatched', 'delivery_failed')`)) as unknown as Array<{ id: string; total_amount: string | number }>;
    return rows.map((r) => ({ orderId: r.id, totalUgx: Number(r.total_amount) }));
  }
}
