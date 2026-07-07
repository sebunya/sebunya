import { pgTable, uuid, varchar, text, integer, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { users } from './identity';
import { orders } from './commerce';

/**
 * First-party data + engagement tables.
 *
 * - activity_events: server-side captured customer interactions
 *   (first-party visitor id, no third-party cookies).
 * - experiments: A/B experiment definitions; assignment is computed
 *   deterministically, exposures land in activity_events.
 * - loyalty_ledger: append-only points ledger; unique (order, reason)
 *   makes earn-on-payment idempotent under webhook replays.
 */

export const activityEvents = pgTable(
  'activity_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    visitorId: varchar('visitor_id', { length: 100 }).notNull(),
    sessionId: varchar('session_id', { length: 100 }),
    userId: uuid('user_id').references(() => users.id),
    eventType: varchar('event_type', { length: 40 }).notNull(),
    path: varchar('path', { length: 500 }),
    entity: varchar('entity', { length: 50 }),
    entityId: varchar('entity_id', { length: 100 }),
    properties: jsonb('properties').default({}).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    visitorIdx: index('activity_events_visitor_idx').on(table.visitorId, table.createdAt),
    typeIdx: index('activity_events_type_idx').on(table.eventType, table.createdAt),
  }),
);

export const experiments = pgTable('experiments', {
  id: uuid('id').defaultRandom().primaryKey(),
  key: varchar('key', { length: 60 }).unique().notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  hypothesis: text('hypothesis'),
  targetMetric: varchar('target_metric', { length: 60 }).default('conversion_rate').notNull(),
  status: varchar('status', { length: 20 }).default('DRAFT').notNull(), // DRAFT | RUNNING | PAUSED | COMPLETED
  variants: jsonb('variants').notNull(), // [{ key, name, weight }]
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const loyaltyLedger = pgTable(
  'loyalty_ledger',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    orderId: uuid('order_id').references(() => orders.id),
    points: integer('points').notNull(), // positive = earned, negative = redeemed
    reason: varchar('reason', { length: 30 }).notNull(), // ORDER_PAID | MANUAL_ADJUSTMENT | REDEMPTION
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orderReasonUnique: uniqueIndex('loyalty_ledger_order_reason_unique').on(table.orderId, table.reason),
    userIdx: index('loyalty_ledger_user_idx').on(table.userId, table.createdAt),
  }),
);
