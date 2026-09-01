import { pgTable, uuid, varchar, timestamp, boolean, integer, jsonb, bigint, date, text, index } from 'drizzle-orm/pg-core';

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).unique().notNull(),
  isOther: boolean('is_other').default(false).notNull(), // Governed "Other" category
  /**
   * 0094 — the category's default shipping class. NULL for every category at
   * ship: an operator sets these, and nothing is guessed in the meantime.
   * Lives on the row rather than in the delivery config registry because it is
   * per-category DATA, not a fixed set of keys.
   */
  defaultShippingClass: varchar('default_shipping_class', { length: 8 }),
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
  /** 0094 — product override, beating the category default. NULL = fall through. */
  shippingClass: varchar('shipping_class', { length: 8 }),
  imageUrl: varchar('image_url', { length: 1000 }),
  features: jsonb('features').$type<string[]>().default([]).notNull(),
  warrantyPeriod: varchar('warranty_period', { length: 100 }).default('1 Year').notNull(),
  verificationEligible: boolean('verification_eligible').default(true).notNull(),
  active: boolean('active').default(true).notNull(),
  
  specifications: jsonb('specifications').$type<Record<string, string | number>>().default({}).notNull(),
  approvalStatus: varchar('approval_status', { length: 20 }).default('draft').notNull(),
  isFeedEligible: boolean('is_feed_eligible').default(true).notNull(),
  isPreOrderEnabled: boolean('is_pre_order_enabled').default(false).notNull(),
  hasRetailPrice: boolean('has_retail_price').default(false).notNull(),
  hasImage: boolean('has_image').default(false).notNull(),
  stockQuantity: integer('stock_quantity').default(0).notNull(),
  // Inventory ledger (Section 12): reserved holds stock committed to open orders;
  // available = stock_quantity - reserved_quantity. reorder_point drives low-stock alerts.
  reservedQuantity: integer('reserved_quantity').default(0).notNull(),
  reorderPoint: integer('reorder_point').default(0).notNull(),
  // Whether this product may be sold without holding stock (migration 0053).
  // Defaults to STOCK_CONTROLLED: an unclassified product must be reserved,
  // never implicitly oversold.
  inventoryPolicy: varchar('inventory_policy', { length: 24 })
    .default('STOCK_CONTROLLED')
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  // U6 — real modification time for sitemap lastmod (AC2). Added by migration 0075.
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const productPrices = pgTable('product_prices', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  retailPrice: integer('retail_price').notNull(),
  dealerPrice: integer('dealer_price'), // Secured, never returned to public
  // Secured. The CURRENT effective supplier cost — a materialisation of
  // product_cost_entries (0104), not an independent truth. Written only by the
  // cost use cases; read by DrizzleOrderRepository to freeze the COGS snapshot
  // at sale. NULL means cost is unknown, which reports UNAVAILABLE, never zero.
  costPrice: integer('cost_price'),
  /** 0127 — the product's own Price A: the lowest price any discount may reach. NULL = not discountable. */
  floorPrice: integer('floor_price'),
  /** 0127 — the workbook's B and C tiers, preserved exactly. No surface reads them yet. */
  tierBPrice: integer('tier_b_price'),
  tierCPrice: integer('tier_c_price'),
});

/**
 * The ONE product-cost owner (0104): what a product cost, from when, on whose
 * authority. Effective-dated so a cost entered today can change what NEW
 * orders snapshot while never rewriting an order_items.cogs_snapshot_ugx
 * already frozen at sale.
 *
 * Corrections are new rows pointing at what they replace (`correctsEntryId`)
 * with the old row stamped `supersededAt` — the trail keeps the wrong number
 * and the right one. Nothing is UPDATEd in place but that stamp.
 */
export const productCostEntries = pgTable('product_cost_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }).notNull(),
  costPriceUgx: bigint('cost_price_ugx', { mode: 'number' }).notNull(),
  currency: varchar('currency', { length: 3 }).default('UGX').notNull(),
  effectiveFrom: date('effective_from').notNull(),
  source: varchar('source', { length: 120 }).notNull(),
  note: text('note'),
  enteredBy: uuid('entered_by'),
  correctsEntryId: uuid('corrects_entry_id'),
  supersededAt: timestamp('superseded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  productIdx: index('product_cost_entries_product_idx').on(table.productId, table.effectiveFrom),
  createdIdx: index('product_cost_entries_created_idx').on(table.createdAt),
}));
