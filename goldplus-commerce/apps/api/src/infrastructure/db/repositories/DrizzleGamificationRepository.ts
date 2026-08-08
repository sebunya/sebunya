import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { customerBadges, gamificationBadges, gamificationMissions } from '../schema/gamification';
import { orders } from '../schema/commerce';
import { reviews } from '../schema/reviews';
import { loyaltyConfig } from '../schema/loyalty';
import { ActiveMission, IGamificationLiveRepository } from '../../../application/use-cases/loyalty/LoyaltyGamificationUseCases';

/**
 * Gamification definitions + dry evaluation over REAL commerce data.
 *
 * PURCHASE_COUNT counts paid orders per signed-in customer (orders.user_id) —
 * phone-only orders are reported as unattributable, never guessed. REVIEW_COUNT
 * counts approved reviews per identity hash, which is a DIFFERENT identity space
 * from user accounts; the evaluator says so instead of pretending linkage.
 * STREAK_DAYS / REFERRAL_COUNT have no data source yet and evaluate as
 * NOT_EVALUABLE. Awards are never written here — the award ledger stays empty
 * until loyalty activation.
 */
export class DrizzleGamificationRepository implements IGamificationLiveRepository {
  /* ── Live engine (0087): active missions with verified data sources ────── */

  async listActiveMissions(): Promise<ActiveMission[]> {
    const missions = await db.select().from(gamificationMissions).where(eq(gamificationMissions.status, 'ACTIVE'));
    const badges = await db.select().from(gamificationBadges);
    return missions.map((m) => ({
      id: m.id,
      key: m.key,
      title: m.title,
      kind: m.kind,
      threshold: m.threshold,
      rewardPoints: m.rewardPoints,
      badgeKey: badges.find((b) => b.missionId === m.id)?.key ?? null,
    }));
  }

  /**
   * Verified progress only. Delivered+paid retail orders for PURCHASE_COUNT
   * and STREAK_ORDERS; successful attributed scans for VERIFICATION_COUNT;
   * awarded referrals for REFERRAL_COUNT. REVIEW_COUNT stays unattributable
   * (separate identity space) and returns null, never a fake zero.
   */
  async missionProgress(userId: string, mission: ActiveMission, opts: { streakWindowDays: number | null }): Promise<number | null> {
    if (mission.kind === 'PURCHASE_COUNT') {
      const rows = (await db.execute(sql`
        select count(*)::int as n from orders
        where user_id = ${userId} and payment_status = 'paid'
          and status in ('delivered','completed') and buyer_type = 'retail'`)) as unknown as Array<{ n: number }>;
      return Number(rows[0]?.n ?? 0);
    }
    if (mission.kind === 'VERIFICATION_COUNT') {
      const rows = (await db.execute(sql`
        select count(*)::int as n from verification_attempts
        where user_id = ${userId} and is_successful = true`)) as unknown as Array<{ n: number }>;
      return Number(rows[0]?.n ?? 0);
    }
    if (mission.kind === 'STREAK_ORDERS') {
      const windowDays = opts.streakWindowDays;
      if (windowDays === null) return null; // streak window unset = streaks off
      const rows = (await db.execute(sql`
        select created_at from orders
        where user_id = ${userId} and payment_status = 'paid'
          and status in ('delivered','completed') and buyer_type = 'retail'
        order by created_at asc`)) as unknown as Array<{ created_at: string | Date }>;
      const dates = rows.map((r) => new Date(r.created_at).getTime());
      let run = 0;
      for (let i = 0; i < dates.length; i++) {
        if (i === 0 || dates[i] - dates[i - 1] <= windowDays * 86_400_000) run += 1;
        else run = 1;
      }
      return run;
    }
    if (mission.kind === 'REFERRAL_COUNT') {
      const rows = (await db.execute(sql`
        select count(*)::int as n from loyalty_referrals
        where referrer_user_id = ${userId} and status = 'awarded'`)) as unknown as Array<{ n: number }>;
      return Number(rows[0]?.n ?? 0);
    }
    return null; // REVIEW_COUNT and unknown kinds: no attributable source
  }

  async awardBadgeByKey(userId: string, badgeKey: string): Promise<boolean> {
    const [badge] = await db.select().from(gamificationBadges).where(eq(gamificationBadges.key, badgeKey)).limit(1);
    if (!badge) return false;
    const inserted = await db
      .insert(customerBadges)
      .values({ userId, badgeId: badge.id })
      .onConflictDoNothing()
      .returning();
    return inserted.length > 0;
  }

  async loyaltyEnabled(): Promise<boolean> {
    try {
      const [row] = await db.select().from(loyaltyConfig).limit(1);
      return Boolean((row as { enabled?: boolean } | undefined)?.enabled);
    } catch {
      return false; // fail-closed: unknown config = dormant
    }
  }

  /** Public badge catalogue — key/title/description only, for the customer
   * loyalty page. No award counts, no customer data. */
  async listCatalogBadges(): Promise<Array<{ key: string; title: string; description: string | null }>> {
    return db
      .select({ key: gamificationBadges.key, title: gamificationBadges.title, description: gamificationBadges.description })
      .from(gamificationBadges)
      .orderBy(desc(gamificationBadges.createdAt));
  }

  async listMissions() {
    const missions = await db.select().from(gamificationMissions).orderBy(desc(gamificationMissions.createdAt));
    const badges = await db.select().from(gamificationBadges).orderBy(desc(gamificationBadges.createdAt));
    const [awardCount] = await db.select({ n: sql<number>`count(*)::int` }).from(customerBadges);
    return { missions, badges, awardedBadges: awardCount?.n ?? 0 };
  }

  async createMission(input: { key: string; title: string; description: string | null; kind: string; threshold: number; rewardPoints: number; createdBy: string | null }) {
    const [row] = await db.insert(gamificationMissions).values(input).onConflictDoNothing().returning();
    return row ?? null;
  }

  async setMissionStatus(id: string, status: string) {
    const [row] = await db.update(gamificationMissions).set({ status }).where(eq(gamificationMissions.id, id)).returning();
    return row ?? null;
  }

  async findMission(id: string) {
    const [row] = await db.select().from(gamificationMissions).where(eq(gamificationMissions.id, id)).limit(1);
    return row ?? null;
  }

  async createBadge(input: { key: string; title: string; description: string | null; missionId: string | null }) {
    const [row] = await db.insert(gamificationBadges).values(input).onConflictDoNothing().returning();
    return row ?? null;
  }

  /** Dry evaluation: who WOULD qualify. Persists nothing. */
  async dryEvaluate(mission: { kind: string; threshold: number }): Promise<{
    evaluable: boolean;
    wouldQualify: number;
    population: number;
    note: string;
  }> {
    if (mission.kind === 'PURCHASE_COUNT') {
      const [row] = await db
        .select({
          qualifying: sql<number>`count(*) filter (where cnt >= ${mission.threshold})::int`,
          population: sql<number>`count(*)::int`,
        })
        .from(
          db
            .select({ userId: orders.userId, cnt: sql<number>`count(*)`.as('cnt') })
            .from(orders)
            .where(sql`${orders.userId} is not null and ${orders.paymentStatus} = 'paid'`)
            .groupBy(orders.userId)
            .as('per_user'),
        );
      const [unattr] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(orders)
        .where(sql`${orders.userId} is null`);
      return {
        evaluable: true,
        wouldQualify: row?.qualifying ?? 0,
        population: row?.population ?? 0,
        note: `Counts PAID orders per signed-in customer. ${unattr?.n ?? 0} order(s) have no account identity and are excluded, not guessed.`,
      };
    }
    if (mission.kind === 'REVIEW_COUNT') {
      const [row] = await db
        .select({
          qualifying: sql<number>`count(*) filter (where cnt >= ${mission.threshold})::int`,
          population: sql<number>`count(*)::int`,
        })
        .from(
          db
            .select({ h: reviews.customerIdentityHash, cnt: sql<number>`count(*)`.as('cnt') })
            .from(reviews)
            .where(sql`${reviews.status} = 'approved'`)
            .groupBy(reviews.customerIdentityHash)
            .as('per_hash'),
        );
      return {
        evaluable: true,
        wouldQualify: row?.qualifying ?? 0,
        population: row?.population ?? 0,
        note: 'Counts approved reviews per identity hash — a separate identity space from customer accounts; awarding requires the identity link that does not exist yet.',
      };
    }
    return {
      evaluable: false,
      wouldQualify: 0,
      population: 0,
      note: `${mission.kind} has no data source yet (streak/referral tracking is unbuilt) — reported as not evaluable rather than zero.`,
    };
  }

  /**
   * One customer's view of the programme: earned badges plus progress against
   * every ACTIVE mission. Progress is only reported where the data genuinely
   * attributes to this account — PURCHASE_COUNT from their paid orders; the
   * other kinds say why they cannot be counted rather than showing a fake 0%.
   */
  async customerSnapshot(userId: string): Promise<{
    badges: Array<{ id: string; key: string; title: string; description: string | null; awardedAt: Date }>;
    missions: Array<{
      id: string;
      key: string;
      title: string;
      description: string | null;
      kind: string;
      threshold: number;
      rewardPoints: number;
      progress: number | null;
      progressNote: string | null;
      completed: boolean;
    }>;
  }> {
    const earned = await db
      .select({
        id: gamificationBadges.id,
        key: gamificationBadges.key,
        title: gamificationBadges.title,
        description: gamificationBadges.description,
        awardedAt: customerBadges.awardedAt,
      })
      .from(customerBadges)
      .innerJoin(gamificationBadges, eq(customerBadges.badgeId, gamificationBadges.id))
      .where(eq(customerBadges.userId, userId))
      .orderBy(desc(customerBadges.awardedAt));

    const activeMissions = await db
      .select()
      .from(gamificationMissions)
      .where(eq(gamificationMissions.status, 'ACTIVE'))
      .orderBy(desc(gamificationMissions.createdAt));

    // 0087: every live kind reports real progress through the same source the
    // award engine uses; only REVIEW_COUNT stays honestly unattributable.
    const [configRow] = await db.select().from(loyaltyConfig).limit(1);
    const streakWindowDays = (configRow as { streakWindowDays?: number | null } | undefined)?.streakWindowDays ?? null;
    const badgeRows = await db.select().from(gamificationBadges);

    const missions = await Promise.all(
      activeMissions.map(async (m) => {
        const mission: ActiveMission = {
          id: m.id,
          key: m.key,
          title: m.title,
          kind: m.kind,
          threshold: m.threshold,
          rewardPoints: m.rewardPoints,
          badgeKey: badgeRows.find((b) => b.missionId === m.id)?.key ?? null,
        };
        const progress = await this.missionProgress(userId, mission, { streakWindowDays });
        return {
          id: m.id,
          key: m.key,
          title: m.title,
          description: m.description,
          kind: m.kind,
          threshold: m.threshold,
          rewardPoints: m.rewardPoints,
          progress,
          progressNote:
            progress !== null
              ? null
              : m.kind === 'REVIEW_COUNT'
                ? 'Reviews are recorded under a separate identity and cannot be counted toward your account yet.'
                : 'This mission type is not tracked yet.',
          completed: progress !== null && progress >= m.threshold,
        };
      }),
    );

    return { badges: earned, missions };
  }
}
