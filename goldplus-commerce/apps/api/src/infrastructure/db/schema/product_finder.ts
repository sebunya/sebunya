import { pgTable, uuid, varchar, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './identity';

export const productFinderSessions = pgTable('product_finder_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  anonymousId: varchar('anonymous_id', { length: 160 }),
  status: varchar('status', { length: 50 }).default('FINDER_STARTED').notNull(),
  answers: jsonb('answers').$type<Record<string, string | string[]>>().default({}).notNull(),
  recommendations: jsonb('recommendations').$type<any[]>().default([]).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  userIdx: index('product_finder_sessions_user_idx').on(table.userId),
  anonymousIdx: index('product_finder_sessions_anonymous_idx').on(table.anonymousId),
}));
