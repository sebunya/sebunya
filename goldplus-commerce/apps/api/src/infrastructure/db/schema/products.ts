import { pgTable, uuid, varchar, timestamp, boolean, integer, jsonb } from 'drizzle-orm/pg-core';

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).unique().notNull(),
  isOther: boolean('is_other').default(false).notNull(), // Governed "Other" category
});

export const products = pgTable('products', {
  id: uuid('id').defaultRandom().primaryKey(),
  sku: varchar('sku', { length: 50 }).unique().notNull(),
  modelNumber: varchar('model_number', { length: 50 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).unique().notNull(),
  categoryId: uuid('category_id').references(() => categories.id).notNull(),
  specifications: jsonb('specifications').$type<Record<string, string | number>>().default({}),
  approvalStatus: varchar('approval_status', { length: 20 }).default('draft').notNull(),
  isFeedEligible: boolean('is_feed_eligible').default(false).notNull(),
  isPreOrderEnabled: boolean('is_pre_order_enabled').default(false).notNull(),
  hasRetailPrice: boolean('has_retail_price').default(false).notNull(),
  hasImage: boolean('has_image').default(false).notNull(),
  stockQuantity: integer('stock_quantity').default(0).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const productPrices = pgTable('product_prices', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  retailPrice: integer('retail_price').notNull(),
  dealerPrice: integer('dealer_price'), // Secured, never returned to public
  costPrice: integer('cost_price'), // Secured
});
