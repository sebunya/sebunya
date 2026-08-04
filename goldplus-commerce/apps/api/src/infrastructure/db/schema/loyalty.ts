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
  singleton: varchar('singleton', { length: 10 }).default('config').notNull(),
});

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
