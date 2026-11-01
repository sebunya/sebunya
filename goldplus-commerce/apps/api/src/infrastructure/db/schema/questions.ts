import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { products } from './products';

/** Questions asked on a product page and the shop's answers (0208, gap analysis #14). */
export const productQuestions = pgTable('product_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id),
  askerIdentityHash: varchar('asker_identity_hash', { length: 64 }).notNull(),
  askerName: varchar('asker_name', { length: 80 }).notNull(),
  askerPhone: varchar('asker_phone', { length: 32 }),
  askerEmail: varchar('asker_email', { length: 254 }),
  question: varchar('question', { length: 500 }).notNull(),
  status: varchar('status', { length: 12 }).notNull().default('pending'), // pending|answered|rejected
  answer: text('answer'),
  answeredBy: uuid('answered_by'),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  productStatusIdx: index('product_questions_product_status_idx').on(t.productId, t.status, t.answeredAt),
  askerDayIdx: index('product_questions_asker_day_idx').on(t.askerIdentityHash, t.createdAt),
}));
