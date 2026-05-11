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
  categoryName: varchar('category_name', { length: 100 }), // Simplifies retrieval
  subcategory: varchar('subcategory', { length: 100 }),
  shortDescription: varchar('short_description', { length: 500 }).default('').notNull(),
  longDescription: varchar('long_description', { length: 5000 }).default('').notNull(),
  priceUgx: integer('price_ugx').default(0).notNull(),
  compareAtPriceUgx: integer('compare_at_price_ugx'),
  stockStatus: varchar('stock_status', { length: 30 }).default('in_stock').notNull(),
  imageUrl: varchar('image_url', { length: 1000 }),
  features: jsonb('features').$type<string[]>().default([]).notNull(),
  warrantyPeriod: varchar('warranty_period', { length: 100 }).default('1 Year').notNull(),
  verificationEligible: boolean('verification_eligible').default(true).notNull(),
  active: boolean('active').default(true).notNull(),
  
  specifications: jsonb('specifications').$type<Record<string, string | number>>().default({}).notNull(),
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
