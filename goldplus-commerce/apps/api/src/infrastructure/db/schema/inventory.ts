import { pgTable, uuid, integer, varchar, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { products } from './products';
import { orders } from './commerce';

/**
 * Inventory ledger (Section 12) — one reservation row per (order, product).
 *
 * `requested_quantity` is what the order asked for; `reserved_quantity` is what
 * was actually held against available stock (a shortfall means backorder). The
 * unique (order_id, product_id) index makes reservation idempotent, so duplicate
 * OrderPlaced handling never double-reserves. Status moves reserved → released
 * (on cancel) or reserved → consumed (stock deducted at dispatch).
 */
export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id').references(() => orders.id).notNull(),
    productId: uuid('product_id').references(() => products.id).notNull(),
    requestedQuantity: integer('requested_quantity').notNull(),
    reservedQuantity: integer('reserved_quantity').notNull(),
    status: varchar('status', { length: 20 }).default('reserved').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orderProductIdx: uniqueIndex('inventory_reservations_order_product_idx').on(table.orderId, table.productId),
    orderIdx: index('inventory_reservations_order_idx').on(table.orderId),
    productIdx: index('inventory_reservations_product_idx').on(table.productId),
    statusIdx: index('inventory_reservations_status_idx').on(table.status),
  })
);
