import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import {
  loyaltyDrawCampaigns,
  loyaltyDrawCompliance,
  loyaltyDrawPrizes,
  loyaltyDrawResults,
  loyaltyDrawTokens,
} from '../schema/loyalty';
import { users } from '../schema/identity';
import { DrawCampaignState, DrawComplianceState, DrawPrize } from '../../../domain/loyalty/RewardDraw';
import { DrawTokenRow, ILoyaltyDrawRepository } from '../../../application/use-cases/loyalty/LoyaltyDrawUseCases';

type CampaignRow = typeof loyaltyDrawCampaigns.$inferSelect;

function toCampaign(row: CampaignRow): DrawCampaignState & { name: string; description: string | null } {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    active: row.active,
    startsAt: row.startsAt ?? null,
    endsAt: row.endsAt ?? null,
    budgetCapPoints: Number(row.budgetCapPoints),
    pointsAwarded: Number(row.pointsAwarded),
    tokenExpiryDays: row.tokenExpiryDays,
  };
}

function toToken(row: typeof loyaltyDrawTokens.$inferSelect): DrawTokenRow {
  return {
    id: row.id,
    campaignId: row.campaignId,
    userId: row.userId,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleLoyaltyDrawRepository implements ILoyaltyDrawRepository {
  async findActiveCampaignByTrigger(trigger: string) {
    const row = await db.query.loyaltyDrawCampaigns.findFirst({
      where: and(eq(loyaltyDrawCampaigns.triggerEvent, trigger), eq(loyaltyDrawCampaigns.active, true)),
    });
    return row ? toCampaign(row) : null;
  }

  async findCampaignById(campaignId: string) {
    const row = await db.query.loyaltyDrawCampaigns.findFirst({ where: eq(loyaltyDrawCampaigns.id, campaignId) });
    return row ? toCampaign(row) : null;
  }

  async listPrizes(campaignId: string): Promise<DrawPrize[]> {
    const rows = await db.query.loyaltyDrawPrizes.findMany({
      where: eq(loyaltyDrawPrizes.campaignId, campaignId),
      orderBy: [asc(loyaltyDrawPrizes.displayOrder)],
    });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      pointsAwarded: r.pointsAwarded,
      weight: r.weight,
      maxAwards: r.maxAwards ?? null,
      awardsMade: r.awardsMade,
      displayOrder: r.displayOrder,
    }));
  }

  async countOutstandingTokens(campaignId: string): Promise<number> {
    const rows = (await db.execute(sql`
      select count(*)::int as n from loyalty_draw_tokens
      where campaign_id = ${campaignId} and status = 'available' and expires_at > now()`)) as unknown as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  }

  async grantToken(input: {
    campaignId: string;
    userId: string;
    accountId: string | null;
    sourceType: string;
    sourceId: string;
    expiresAt: Date;
  }): Promise<DrawTokenRow | null> {
    // onConflictDoNothing against the (campaign, source) unique index is what
    // makes a retried delivery event grant exactly one card.
    const rows = await db
      .insert(loyaltyDrawTokens)
      .values({
        campaignId: input.campaignId,
        userId: input.userId,
        accountId: input.accountId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        expiresAt: input.expiresAt,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0] ? toToken(rows[0]) : null;
  }

  async listAvailableTokens(userId: string, now: Date): Promise<DrawTokenRow[]> {
    const rows = await db.query.loyaltyDrawTokens.findMany({
      where: and(eq(loyaltyDrawTokens.userId, userId), eq(loyaltyDrawTokens.status, 'available')),
      orderBy: [asc(loyaltyDrawTokens.createdAt)],
    });
    return rows.filter((r) => r.expiresAt > now).map(toToken);
  }

  async findToken(tokenId: string): Promise<DrawTokenRow | null> {
    const row = await db.query.loyaltyDrawTokens.findFirst({ where: eq(loyaltyDrawTokens.id, tokenId) });
    return row ? toToken(row) : null;
  }

  /**
   * The single-use guarantee. The WHERE clause includes status='available',
   * so of N concurrent requests for the same card exactly one UPDATE matches a
   * row and returns it; the rest return nothing and are refused.
   */
  async claimToken(tokenId: string, userId: string, now: Date): Promise<DrawTokenRow | null> {
    const rows = await db
      .update(loyaltyDrawTokens)
      .set({ status: 'played', playedAt: now })
      .where(
        and(
          eq(loyaltyDrawTokens.id, tokenId),
          eq(loyaltyDrawTokens.userId, userId),
          eq(loyaltyDrawTokens.status, 'available'),
          sql`${loyaltyDrawTokens.expiresAt} > ${now}`,
        ),
      )
      .returning();
    return rows[0] ? toToken(rows[0]) : null;
  }

  async releaseToken(tokenId: string): Promise<void> {
    await db
      .update(loyaltyDrawTokens)
      .set({ status: 'available', playedAt: null })
      .where(and(eq(loyaltyDrawTokens.id, tokenId), eq(loyaltyDrawTokens.status, 'played')));
  }

  async recordResult(input: {
    tokenId: string;
    campaignId: string;
    prizeId: string;
    userId: string;
    pointsAwarded: number;
    ledgerEntryId: string | null;
    prizeSnapshot: unknown;
  }): Promise<void> {
    await db
      .insert(loyaltyDrawResults)
      .values({
        tokenId: input.tokenId,
        campaignId: input.campaignId,
        prizeId: input.prizeId,
        userId: input.userId,
        pointsAwarded: input.pointsAwarded,
        ledgerEntryId: input.ledgerEntryId,
        prizeSnapshot: input.prizeSnapshot as never,
      })
      .onConflictDoNothing();
  }

  async incrementPrizeAward(prizeId: string): Promise<void> {
    await db
      .update(loyaltyDrawPrizes)
      .set({ awardsMade: sql`${loyaltyDrawPrizes.awardsMade} + 1` })
      .where(eq(loyaltyDrawPrizes.id, prizeId));
  }

  async incrementCampaignTotals(campaignId: string, pointsAwarded: number, tokensGranted: number): Promise<void> {
    await db
      .update(loyaltyDrawCampaigns)
      .set({
        pointsAwarded: sql`${loyaltyDrawCampaigns.pointsAwarded} + ${pointsAwarded}`,
        tokensGranted: sql`${loyaltyDrawCampaigns.tokensGranted} + ${tokensGranted}`,
        updatedAt: new Date(),
      })
      .where(eq(loyaltyDrawCampaigns.id, campaignId));
  }

  async findResultByToken(tokenId: string) {
    const row = await db.query.loyaltyDrawResults.findFirst({ where: eq(loyaltyDrawResults.tokenId, tokenId) });
    return row ? { pointsAwarded: row.pointsAwarded, prizeId: row.prizeId } : null;
  }

  async expireTokensDueBefore(now: Date): Promise<number> {
    const rows = await db
      .update(loyaltyDrawTokens)
      .set({ status: 'expired' })
      .where(and(eq(loyaltyDrawTokens.status, 'available'), sql`${loyaltyDrawTokens.expiresAt} <= ${now}`))
      .returning({ id: loyaltyDrawTokens.id });
    return rows.length;
  }

  /* ── Compliance (0090) ─────────────────────────────────────────────────── */

  async getCompliance(): Promise<DrawComplianceState> {
    const row = await db.query.loyaltyDrawCompliance.findFirst();
    // No row at all is the same as no basis: fail closed.
    return {
      basis: (row?.basis as DrawComplianceState['basis']) ?? 'none',
      licenceReference: row?.licenceReference ?? null,
      licenceExpiresAt: row?.licenceExpiresAt ? new Date(`${row.licenceExpiresAt}T23:59:59Z`) : null,
      counselReference: row?.counselReference ?? null,
      minAge: row?.minAge ?? 25,
      jurisdiction: row?.jurisdiction ?? 'UG',
    };
  }

  async getComplianceRecord() {
    return db.query.loyaltyDrawCompliance.findFirst();
  }

  async saveCompliance(input: {
    basis: string;
    licenceReference: string | null;
    licenceIssuer: string | null;
    licenceExpiresAt: string | null;
    counselReference: string | null;
    counselOpinionDate: string | null;
    minAge: number;
    notes: string | null;
    acknowledgedBy: string;
  }) {
    const rows = await db
      .update(loyaltyDrawCompliance)
      .set({
        basis: input.basis,
        licenceReference: input.licenceReference,
        licenceIssuer: input.licenceIssuer,
        licenceExpiresAt: input.licenceExpiresAt,
        counselReference: input.counselReference,
        counselOpinionDate: input.counselOpinionDate,
        minAge: input.minAge,
        notes: input.notes,
        // 'none' clears the acknowledgement; any other basis records who accepted it.
        acknowledgedBy: input.basis === 'none' ? null : input.acknowledgedBy,
        acknowledgedAt: input.basis === 'none' ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(loyaltyDrawCompliance.singleton, 'compliance'))
      .returning();
    return rows[0] ?? null;
  }

  async participantEligibility(userId: string): Promise<{ dateOfBirth: string | null; selfExcludedAt: Date | null }> {
    const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
    const typed = row as { dateOfBirth?: string | null; chanceSelfExcludedAt?: Date | null } | undefined;
    return { dateOfBirth: typed?.dateOfBirth ?? null, selfExcludedAt: typed?.chanceSelfExcludedAt ?? null };
  }

  async setSelfExclusion(userId: string, excluded: boolean): Promise<void> {
    await db
      .update(users)
      .set({ chanceSelfExcludedAt: excluded ? new Date() : null })
      .where(eq(users.id, userId));
  }

  /** Every play, for a regulator or an auditor. */
  async regulatoryExport(): Promise<Array<Record<string, unknown>>> {
    const rows = (await db.execute(sql`
      select r.created_at, r.id as result_id, r.token_id, r.user_id, r.points_awarded,
             r.ledger_entry_id, p.label as prize_label, p.weight, c.code as campaign_code,
             t.source_type, t.source_id, t.created_at as card_granted_at
      from loyalty_draw_results r
      join loyalty_draw_prizes p on p.id = r.prize_id
      join loyalty_draw_campaigns c on c.id = r.campaign_id
      join loyalty_draw_tokens t on t.id = r.token_id
      order by r.created_at desc`)) as unknown as Array<Record<string, unknown>>;
    return rows;
  }

  /* ── Admin reads ───────────────────────────────────────────────────────── */

  async listCampaignsWithStats() {
    const campaigns = await db.query.loyaltyDrawCampaigns.findMany({ orderBy: [asc(loyaltyDrawCampaigns.createdAt)] });
    return Promise.all(
      campaigns.map(async (c) => ({
        ...toCampaign(c),
        prizes: await this.listPrizes(c.id),
        outstandingTokens: await this.countOutstandingTokens(c.id),
      })),
    );
  }

  async setCampaignBudget(campaignId: string, budgetCapPoints: number, actorId: string) {
    const rows = await db
      .update(loyaltyDrawCampaigns)
      .set({ budgetCapPoints, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(loyaltyDrawCampaigns.id, campaignId))
      .returning();
    return rows[0] ? toCampaign(rows[0]) : null;
  }

  async setCampaignActive(campaignId: string, active: boolean, actorId: string) {
    const rows = await db
      .update(loyaltyDrawCampaigns)
      .set({ active, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(loyaltyDrawCampaigns.id, campaignId))
      .returning();
    return rows[0] ? toCampaign(rows[0]) : null;
  }
}
