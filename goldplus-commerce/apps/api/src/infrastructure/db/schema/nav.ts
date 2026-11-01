import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * Header/nav CMS (0109/0110). The whole editable header is ONE validated JSONB
 * document (singleton row, id pinned true) — heterogeneous content, versioned and
 * edited atomically. nav_events is the nav's own telemetry sink (§10), kept
 * deliberately separate from hero_events and recommendation_events.
 */
export const navConfig = pgTable('nav_config', {
  id: boolean('id').default(true).primaryKey(),
  config: jsonb('config').default({}).notNull(),
  version: integer('version').default(1).notNull(),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const navEvents = pgTable(
  'nav_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventType: varchar('event_type', { length: 24 }).notNull(),
    itemKey: varchar('item_key', { length: 32 }).default('').notNull(),
    position: integer('position').default(0).notNull(),
    segment: varchar('segment', { length: 16 }).default('unknown').notNull(),
    term: varchar('term', { length: 80 }),
    profileId: uuid('profile_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    typeItemIdx: index('nav_events_type_item_idx').on(t.eventType, t.itemKey),
    createdIdx: index('nav_events_created_idx').on(t.createdAt),
    // Matches the partial index migration 0110 creates — keeps the schema an
    // accurate model of the table (so a future drizzle-kit diff never drops it).
    zeroTermIdx: index('nav_events_zero_term_idx')
      .on(t.term)
      .where(sql`event_type = 'SEARCH_ZERO' AND term IS NOT NULL`),
  }),
);
