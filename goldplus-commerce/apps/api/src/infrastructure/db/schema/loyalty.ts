import { pgTable, uuid, varchar, integer, boolean, timestamp, uniqueIndex, index, check, bigint, jsonb, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './identity';
import { orders } from './commerce';

/**
 * Slice 8: loyalty ledger — source-complete, DORMANT. Mutations are gated by
 * LOYALTY_PROGRAMME_ENABLED and the config row's enabled switch, both off.
 * Balances are derived from the ledger, never stored.
 */
export const loyaltyAccounts = pgTable('loyalty_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  // 0085: RESTRICT (was cascade) — a financial ledger must not vanish because
  // a users row was deleted; account closure is an explicit audited decision.
  userId: uuid('user_id').references(() => users.id, { onDelete: 'restrict' }).notNull(),
  /** 0085: dealer volume never distorts consumer-programme reporting. */
  isDealer: boolean('is_dealer').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdx: uniqueIndex('loyalty_accounts_user_idx').on(table.userId),
}));

export const loyaltyLedgerEntries = pgTable('loyalty_ledger_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => loyaltyAccounts.id, { onDelete: 'restrict' }).notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  points: integer('points').notNull(),
  orderId: uuid('order_id').references(() => orders.id),
  reason: varchar('reason', { length: 300 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 120 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  reversedEntryId: uuid('reversed_entry_id'),
  // 0085: the rule version that granted the entry (rate changes never rewrite history)
  ruleCode: varchar('rule_code', { length: 40 }),
  ruleVersion: integer('rule_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idemIdx: uniqueIndex('loyalty_ledger_idem_idx').on(table.idempotencyKey),
  accountIdx: index('loyalty_ledger_account_idx').on(table.accountId),
  orderIdx: index('loyalty_ledger_order_idx').on(table.orderId),
  reversalSourceIdx: uniqueIndex('loyalty_ledger_reversal_source_idx').on(table.reversedEntryId)
    .where(sql`${table.type} = 'reversal'`),
  expirySourceIdx: uniqueIndex('loyalty_ledger_expiry_source_idx').on(table.reversedEntryId)
    .where(sql`${table.type} = 'expiry'`),
  typeCheck: check('loyalty_ledger_type_check', sql`${table.type} in ('earn', 'redeem', 'reversal', 'expiry', 'adjustment')`),
  shapeCheck: check('loyalty_ledger_shape_check', sql`
    ${table.points} <> 0 and (
      (${table.type} = 'earn' and ${table.points} > 0 and ${table.orderId} is not null and ${table.reversedEntryId} is null)
      or (${table.type} = 'redeem' and ${table.points} < 0 and ${table.reversedEntryId} is null)
      or (${table.type} = 'expiry' and ${table.points} < 0 and ${table.reversedEntryId} is not null)
      or (${table.type} = 'reversal' and ${table.reversedEntryId} is not null)
      or (${table.type} = 'adjustment' and ${table.reversedEntryId} is null)
    )
  `),
}));

export const loyaltyConfig = pgTable('loyalty_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  enabled: boolean('enabled').default(false).notNull(),
  earnRatePer1000Ugx: integer('earn_rate_per_1000_ugx').default(0).notNull(),
  expiryDays: integer('expiry_days').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  // ── 0085 programme config (loyalty brief PART E). EVERY value starts NULL;
  // null blocks activation of the thing it governs. Rob sets these (PART V).
  pointValueUgx: integer('point_value_ugx'),
  redemptionMinPoints: integer('redemption_min_points'),
  redemptionMaxShareBps: integer('redemption_max_share_bps'),
  budgetCapPoints: bigint('budget_cap_points', { mode: 'number' }),
  killSwitch: boolean('kill_switch').default(false).notNull(),
  guestBackfillLookbackDays: integer('guest_backfill_lookback_days'),
  guestBackfillCapPoints: integer('guest_backfill_cap_points'),
  // ── 0087 gamification values (Rob activated the programme 2026-08-05).
  referralReferrerPoints: integer('referral_referrer_points'),
  referralRefereePoints: integer('referral_referee_points'),
  birthdayPoints: integer('birthday_points'),
  streakTargetOrders: integer('streak_target_orders'),
  streakWindowDays: integer('streak_window_days'),
  streakRewardPoints: integer('streak_reward_points'),
  /** Chance mechanics stay OFF pending the PART P legal read — flag reserved. */
  chanceEnabled: boolean('chance_enabled').default(false).notNull(),
  termsVersion: varchar('terms_version', { length: 20 }),
  singleton: varchar('singleton', { length: 10 }).default('config').notNull(),
});

/** 0087: referral facts. One row per referee ever; awards reference ledger entries. */
export const loyaltyReferrals = pgTable('loyalty_referrals', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 12 }).notNull(),
  referrerUserId: uuid('referrer_user_id').notNull(),
  refereeUserId: uuid('referee_user_id').notNull(),
  status: varchar('status', { length: 12 }).default('pending').notNull(), // pending|awarded|rejected
  qualifyingOrderId: uuid('qualifying_order_id'),
  referrerEntryId: uuid('referrer_entry_id'),
  refereeEntryId: uuid('referee_entry_id'),
  rejectionReason: varchar('rejection_reason', { length: 120 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  refereeIdx: uniqueIndex('loyalty_referrals_referee_uq').on(table.refereeUserId),
  referrerIdx: index('loyalty_referrals_referrer_idx').on(table.referrerUserId),
}));

export const loyaltyRules = pgTable('loyalty_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  ruleCode: varchar('rule_code', { length: 40 }).notNull(),
  version: integer('version').notNull(),
  earnBasis: varchar('earn_basis', { length: 20 }).notNull(),
  rate: integer('rate').notNull(),
  capPerPeriod: integer('cap_per_period'),
  capPeriod: varchar('cap_period', { length: 10 }),
  capPerCustomer: integer('cap_per_customer'),
  eligibility: jsonb('eligibility'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).defaultNow().notNull(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  active: boolean('active').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  codeVersionIdx: uniqueIndex('loyalty_rules_code_version_idx').on(table.ruleCode, table.version),
}));

export const loyaltyRedemptions = pgTable('loyalty_redemptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => loyaltyAccounts.id, { onDelete: 'restrict' }).notNull(),
  orderId: uuid('order_id'),
  pointsReserved: integer('points_reserved').notNull(),
  valueUgx: bigint('value_ugx', { mode: 'number' }).notNull(),
  pointValueUgx: integer('point_value_ugx').notNull(),
  ruleVersion: integer('rule_version'),
  status: varchar('status', { length: 12 }).default('reserved').notNull(), // reserved|applied|released|reversed
  idempotencyKey: varchar('idempotency_key', { length: 120 }).notNull(),
  ledgerEntryId: uuid('ledger_entry_id'),
  reservedUntil: timestamp('reserved_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idemIdx: uniqueIndex('loyalty_redemptions_idem_idx').on(table.idempotencyKey),
  orderIdx: index('loyalty_redemptions_order_idx').on(table.orderId),
  statusIdx: index('loyalty_redemptions_status_idx').on(table.status),
}));

export const loyaltyExpiryNotices = pgTable('loyalty_expiry_notices', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').notNull(),
  earnEntryId: uuid('earn_entry_id').notNull(),
  noticeKind: varchar('notice_kind', { length: 10 }).notNull(), // 30d|7d|1d
  channel: varchar('channel', { length: 20 }).notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  onceIdx: uniqueIndex('loyalty_expiry_notices_once_idx').on(table.earnEntryId, table.noticeKind),
}));

export const loyaltyLiabilitySnapshots = pgTable('loyalty_liability_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  snapshotDate: date('snapshot_date').notNull(),
  pointsOutstanding: bigint('points_outstanding', { mode: 'number' }).notNull(),
  pointsIssued: bigint('points_issued', { mode: 'number' }).notNull(),
  pointsRedeemed: bigint('points_redeemed', { mode: 'number' }).notNull(),
  pointsExpired: bigint('points_expired', { mode: 'number' }).notNull(),
  pointsClawedBack: bigint('points_clawed_back', { mode: 'number' }).notNull(),
  pendingPoints: bigint('pending_points', { mode: 'number' }).default(0).notNull(),
  pointValueUgx: integer('point_value_ugx'),
  liabilityUgx: bigint('liability_ugx', { mode: 'number' }),
  breakageEstimateBps: integer('breakage_estimate_bps'),
  redemptionRateBps: integer('redemption_rate_bps'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  dateIdx: uniqueIndex('loyalty_liability_snapshot_date_idx').on(table.snapshotDate),
}));

export const loyaltyFraudSignals = pgTable('loyalty_fraud_signals', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id'),
  userId: uuid('user_id'),
  signalType: varchar('signal_type', { length: 40 }).notNull(),
  severity: varchar('severity', { length: 10 }).default('medium').notNull(),
  details: jsonb('details'),
  forwardedToFraudCase: uuid('forwarded_to_fraud_case'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  accountIdx: index('loyalty_fraud_signals_account_idx').on(table.accountId),
}));


export const loyaltyAccountMerges = pgTable('loyalty_account_merges', {
  mergedAccountId: uuid('merged_account_id').primaryKey(),
  survivorAccountId: uuid('survivor_account_id').notNull(),
  actorId: uuid('actor_id'),
  note: varchar('note', { length: 300 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const loyaltyTiers = pgTable('loyalty_tiers', {
  code: varchar('code', { length: 20 }).primaryKey(),
  name: varchar('name', { length: 60 }).notNull(),
  thresholdLifetimePoints: integer('threshold_lifetime_points'),
  benefits: jsonb('benefits'),
  rank: integer('rank').notNull(),
  active: boolean('active').default(false).notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const loyaltyTierAssignments = pgTable('loyalty_tier_assignments', {
  accountId: uuid('account_id').primaryKey(),
  tierCode: varchar('tier_code', { length: 20 }).notNull(),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
});

/* ── 0088: reward draw (scratch / spin) ──────────────────────────────────
 * Chance mechanic with the consideration and the losing outcome removed:
 * tokens are granted for an ALREADY delivered order, and every prize tier
 * awards points > 0 (CHECK-enforced). Gated by loyalty_config.chance_enabled
 * AND the programme kill switch AND per-campaign activation.
 */
export const loyaltyDrawCampaigns = pgTable('loyalty_draw_campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 40 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  description: varchar('description', { length: 500 }),
  triggerEvent: varchar('trigger_event', { length: 30 }).notNull(), // order_delivered | verification_scan
  tokenExpiryDays: integer('token_expiry_days').notNull(),
  budgetCapPoints: bigint('budget_cap_points', { mode: 'number' }).notNull(),
  pointsAwarded: bigint('points_awarded', { mode: 'number' }).default(0).notNull(),
  tokensGranted: integer('tokens_granted').default(0).notNull(),
  active: boolean('active').default(false).notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  codeIdx: uniqueIndex('loyalty_draw_campaigns_code_uq').on(table.code),
}));

export const loyaltyDrawPrizes = pgTable('loyalty_draw_prizes', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').references(() => loyaltyDrawCampaigns.id, { onDelete: 'restrict' }).notNull(),
  label: varchar('label', { length: 80 }).notNull(),
  pointsAwarded: integer('points_awarded').notNull(),
  weight: integer('weight').notNull(),
  maxAwards: integer('max_awards'),
  awardsMade: integer('awards_made').default(0).notNull(),
  displayOrder: integer('display_order').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  campaignIdx: index('loyalty_draw_prizes_campaign_idx').on(table.campaignId),
}));

export const loyaltyDrawTokens = pgTable('loyalty_draw_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  campaignId: uuid('campaign_id').references(() => loyaltyDrawCampaigns.id, { onDelete: 'restrict' }).notNull(),
  userId: uuid('user_id').notNull(),
  accountId: uuid('account_id'),
  sourceType: varchar('source_type', { length: 30 }).notNull(),
  sourceId: uuid('source_id').notNull(),
  status: varchar('status', { length: 12 }).default('available').notNull(), // available|played|expired
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  playedAt: timestamp('played_at', { withTimezone: true }),
}, (table) => ({
  /** One token per qualifying event, ever — this is what makes granting idempotent. */
  sourceIdx: uniqueIndex('loyalty_draw_tokens_source_uq').on(table.campaignId, table.sourceType, table.sourceId),
  userIdx: index('loyalty_draw_tokens_user_idx').on(table.userId, table.status),
}));

export const loyaltyDrawResults = pgTable('loyalty_draw_results', {
  id: uuid('id').defaultRandom().primaryKey(),
  tokenId: uuid('token_id').references(() => loyaltyDrawTokens.id, { onDelete: 'restrict' }).notNull(),
  campaignId: uuid('campaign_id').references(() => loyaltyDrawCampaigns.id, { onDelete: 'restrict' }).notNull(),
  prizeId: uuid('prize_id').references(() => loyaltyDrawPrizes.id, { onDelete: 'restrict' }).notNull(),
  userId: uuid('user_id').notNull(),
  pointsAwarded: integer('points_awarded').notNull(),
  ledgerEntryId: uuid('ledger_entry_id'),
  /** The odds table in force at play time — a later weight edit cannot rewrite it. */
  prizeSnapshot: jsonb('prize_snapshot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  /** Structural guarantee that one token can never yield two prizes. */
  tokenIdx: uniqueIndex('loyalty_draw_results_token_uq').on(table.tokenId),
  userIdx: index('loyalty_draw_results_user_idx').on(table.userId),
}));

/**
 * 0090: the recorded legal basis on which reward draws may operate.
 *
 * Uganda's Lotteries and Gaming Act 2016 defines "lottery" to include a
 * "promotional competition" with no consideration element, so a free-to-enter
 * design does not obviously escape licensing. Rather than encode a legal
 * conclusion in code, draws refuse to run until a basis is recorded here —
 * either an LGRB licence or a written opinion from counsel.
 */
export const loyaltyDrawCompliance = pgTable('loyalty_draw_compliance', {
  id: uuid('id').defaultRandom().primaryKey(),
  basis: varchar('basis', { length: 30 }).default('none').notNull(), // none|licensed|counsel_advised_exempt
  licenceReference: varchar('licence_reference', { length: 120 }),
  licenceIssuer: varchar('licence_issuer', { length: 160 }),
  licenceExpiresAt: date('licence_expires_at'),
  counselReference: varchar('counsel_reference', { length: 300 }),
  counselOpinionDate: date('counsel_opinion_date'),
  /** 25 = the Act's definition of a "minor" for gaming purposes. */
  minAge: integer('min_age').default(25).notNull(),
  jurisdiction: varchar('jurisdiction', { length: 8 }).default('UG').notNull(),
  acknowledgedBy: uuid('acknowledged_by'),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  notes: varchar('notes', { length: 1000 }),
  singleton: varchar('singleton', { length: 12 }).default('compliance').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  singletonIdx: uniqueIndex('loyalty_draw_compliance_singleton_uq').on(table.singleton),
}));

export const phoneVerificationCodes = pgTable('phone_verification_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  phoneE164: varchar('phone_e164', { length: 20 }).notNull(),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdx: index('phone_verification_user_idx').on(table.userId),
}));
