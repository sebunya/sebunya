import { pgTable, uuid, varchar, boolean, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { products } from './products';

/**
 * Slice 5: admin-declared product compatibility mappings — catalogue truth
 * shown on PDPs. Verdict is never 'unknown' (absence of a row is unknown).
 */
export const productCompatibilityMappings = pgTable('product_compatibility_mappings', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
  targetProductId: uuid('target_product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
  verdict: varchar('verdict', { length: 20 }).notNull(),
  note: varchar('note', { length: 300 }),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  pairIdx: uniqueIndex('compat_pair_idx').on(table.productId, table.targetProductId),
  productIdx: index('compat_product_idx').on(table.productId),
}));
