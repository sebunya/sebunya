import { pgTable, uuid, varchar, timestamp, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Gamification scaffold (§32 tail) on the DORMANT loyalty core.
 *
 * Missions and badges are DEFINITIONS; `customer_badges` is the award ledger that
 * stays EMPTY until loyalty is activated — evaluation runs dry (who WOULD qualify)
 * and awarding is refused with LOYALTY_DORMANT, the same no-value-until-activation
 * rule the loyalty core already enforces.
 */
export const gamificationMissions = pgTable(
  'gamification_missions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 60 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: varchar('description', { length: 500 }),
    kind: varchar('kind', { length: 30 }).notNull(), // PURCHASE_COUNT | REVIEW_COUNT | STREAK_DAYS | REFERRAL_COUNT
    threshold: integer('threshold').notNull(),
    rewardPoints: integer('reward_points').default(0).notNull(),
    status: varchar('status', { length: 12 }).default('DRAFT').notNull(), // DRAFT | ACTIVE | ARCHIVED
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ keyUq: uniqueIndex('gamification_missions_key_uq').on(t.key) }),
);

export const gamificationBadges = pgTable(
  'gamification_badges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 60 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    description: varchar('description', { length: 500 }),
    missionId: uuid('mission_id').references(() => gamificationMissions.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ keyUq: uniqueIndex('gamification_badges_key_uq').on(t.key) }),
);

export const customerBadges = pgTable(
  'customer_badges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    badgeId: uuid('badge_id').references(() => gamificationBadges.id, { onDelete: 'cascade' }).notNull(),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userBadgeUq: uniqueIndex('customer_badges_user_badge_uq').on(t.userId, t.badgeId),
    userIdx: index('customer_badges_user_idx').on(t.userId),
  }),
);
