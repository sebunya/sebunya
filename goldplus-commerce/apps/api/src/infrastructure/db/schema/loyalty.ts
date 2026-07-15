import { pgTable, uuid, varchar, integer, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { orders } from './commerce';

/**
 * Slice 8: loyalty ledger — source-complete, DORMANT. Mutations are gated by
 * LOYALTY_PROGRAMME_ENABLED and the config row's enabled switch, both off.
 * Balances are derived from the ledger, never stored.
 */
export const loyaltyAccounts = pgTable('loyalty_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdx: uniqueIndex('loyalty_accounts_user_idx').on(table.userId),
}));

export const loyaltyLedgerEntries = pgTable('loyalty_ledger_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => loyaltyAccounts.id, { onDelete: 'cascade' }).notNull(),
  type: varchar('type', { length: 20 }).notNull(),
  points: integer('points').notNull(),
  orderId: uuid('order_id').references(() => orders.id),
  reason: varchar('reason', { length: 300 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 120 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  reversedEntryId: uuid('reversed_entry_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  idemIdx: uniqueIndex('loyalty_ledger_idem_idx').on(table.idempotencyKey),
  accountIdx: index('loyalty_ledger_account_idx').on(table.accountId),
}));

export const loyaltyConfig = pgTable('loyalty_config', {
  id: uuid('id').defaultRandom().primaryKey(),
  enabled: boolean('enabled').default(false).notNull(),
  earnRatePer1000Ugx: integer('earn_rate_per_1000_ugx').default(0).notNull(),
  expiryDays: integer('expiry_days').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
