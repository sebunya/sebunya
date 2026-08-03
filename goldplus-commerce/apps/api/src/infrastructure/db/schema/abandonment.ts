import { pgTable, uuid, varchar, timestamp, integer, bigint, index, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Cart abandonment classifications (Wave 2E-1).
 *
 * Written only by the scheduled evaluator — a cart with items whose last activity is
 * older than the threshold becomes one OPEN row (unique per cart while open).
 * Downstream consumers (campaign eligibility in a later wave) read these rows; they
 * never re-derive staleness themselves, so "abandoned" means exactly one thing
 * platform-wide.
 */
export const cartAbandonments = pgTable(
  'cart_abandonments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cartId: uuid('cart_id').notNull(),
    ownerKind: varchar('owner_kind', { length: 8 }),
    ownerId: varchar('owner_id', { length: 128 }),
    itemCount: integer('item_count').notNull(),
    subtotalUgx: bigint('subtotal_ugx', { mode: 'number' }).notNull(),
    reason: varchar('reason', { length: 30 }).default('STALE_TIMEOUT').notNull(),
    status: varchar('status', { length: 12 }).default('OPEN').notNull(), // OPEN | EXPIRED | RECOVERED
    classifiedAt: timestamp('classified_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    // One live classification per cart; resolved rows keep history.
    openCartUq: uniqueIndex('cart_abandonments_open_cart_uq').on(t.cartId, t.status),
    statusIdx: index('cart_abandonments_status_idx').on(t.status),
    classifiedIdx: index('cart_abandonments_classified_idx').on(t.classifiedAt),
  }),
);
