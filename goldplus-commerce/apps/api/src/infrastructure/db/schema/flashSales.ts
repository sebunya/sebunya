import { bigint, index, integer, pgTable, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { products } from './products';
import { promotionDefinitions } from './pricing';

/**
 * U5 — flash sales. A flash sale is a promotion (extends U1) with a separately
 * allocated unit pool and server-authoritative timing. PostgreSQL is the durable
 * commercial truth; Redis (when configured) is the high-rate front reconciled
 * back here. Allocation is decremented through a reservation, never directly, so
 * it cannot consume inventory promised to dealers/pre-orders.
 */
export const flashSales = pgTable('flash_sales', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 160 }).notNull(),
  promotionId: uuid('promotion_id').references(() => promotionDefinitions.id),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  revealAt: timestamp('reveal_at', { withTimezone: true }),
  allocationType: varchar('allocation_type', { length: 24 }).notNull().default('fixed_units'),
  perCustomerLimit: integer('per_customer_limit'),
  perOrderLimit: integer('per_order_limit'),
  queueCapacity: integer('queue_capacity'),
  status: varchar('status', { length: 12 }).notNull().default('draft'), // draft|scheduled|live|sold_out|ended|cancelled
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ statusIdx: index('flash_sales_status_idx').on(table.status, table.startsAt) }));

export const flashSaleItems = pgTable('flash_sale_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  flashSaleId: uuid('flash_sale_id').notNull().references(() => flashSales.id),
  productId: uuid('product_id').notNull().references(() => products.id),
  flashPriceUgx: bigint('flash_price_ugx', { mode: 'number' }).notNull(),
  originalPriceUgx: bigint('original_price_ugx', { mode: 'number' }).notNull(),
  unitsAllocated: integer('units_allocated').notNull(),
  unitsSold: integer('units_sold').notNull().default(0),
  unitsReserved: integer('units_reserved').notNull().default(0),
}, (table) => ({ saleProductIdx: uniqueIndex('flash_sale_items_sale_product_idx').on(table.flashSaleId, table.productId) }));

export const flashSaleReservations = pgTable('flash_sale_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  flashSaleItemId: uuid('flash_sale_item_id').notNull().references(() => flashSaleItems.id),
  customerIdentityHash: varchar('customer_identity_hash', { length: 64 }).notNull(),
  reservationToken: varchar('reservation_token', { length: 80 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 120 }).notNull(),
  quantity: integer('quantity').notNull().default(1),
  status: varchar('status', { length: 12 }).notNull().default('reserved'), // reserved|confirmed|released|expired
  reservedAt: timestamp('reserved_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
}, (table) => ({
  tokenIdx: uniqueIndex('flash_sale_reservations_token_idx').on(table.reservationToken),
  idempotencyIdx: uniqueIndex('flash_sale_reservations_idempotency_idx').on(table.idempotencyKey),
  itemCustomerIdx: index('flash_sale_reservations_item_customer_idx').on(table.flashSaleItemId, table.customerIdentityHash, table.status),
  expiryIdx: index('flash_sale_reservations_expiry_idx').on(table.status, table.expiresAt),
}));
