import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { customerBadges, gamificationBadges, gamificationMissions } from '../schema/gamification';
import { orders } from '../schema/commerce';
import { reviews } from '../schema/reviews';
import { loyaltyConfig } from '../schema/loyalty';

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
export class DrizzleGamificationRepository {
  async loyaltyEnabled(): Promise<boolean> {
    try {
      const [row] = await db.select().from(loyaltyConfig).limit(1);
      return Boolean((row as { enabled?: boolean } | undefined)?.enabled);
    } catch {
      return false; // fail-closed: unknown config = dormant
    }
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
}
