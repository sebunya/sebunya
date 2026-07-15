import { pgTable, uuid, varchar, timestamp, integer, index, jsonb, boolean, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { products } from './products';
import { users } from './identity';

export const carts = pgTable('carts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id'),
  sessionId: varchar('session_id', { length: 255 }),
  anonymousId: varchar('anonymous_id', { length: 160 }),
}, (table) => ({
  sessionIdx: index('carts_session_idx').on(table.sessionId),
  anonymousIdx: index('carts_anonymous_idx').on(table.anonymousId),
}));

export const cartItems = pgTable('cart_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  cartId: uuid('cart_id').references(() => carts.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  quantity: integer('quantity').notNull(),
});

export const orders = pgTable('orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id),
  orderNumber: varchar('order_number', { length: 20 }).unique().notNull(),
  buyerType: varchar('buyer_type', { length: 20 }).default('retail').notNull(),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  customerPhone: varchar('customer_phone', { length: 20 }).notNull(),
  customerEmail: varchar('customer_email', { length: 255 }),
  deliveryArea: varchar('delivery_area', { length: 255 }).notNull(),
  deliveryAddress: varchar('delivery_address', { length: 255 }).notNull(),
  status: varchar('status', { length: 30 }).default('received').notNull(),
  paymentStatus: varchar('payment_status', { length: 30 }).default('unpaid').notNull(),
  subtotalAmount: integer('subtotal_amount').notNull(),
  deliveryFee: integer('delivery_fee').notNull().default(0),
  totalAmount: integer('total_amount').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

  // Pass 13A: Stitching context
  anonymousId: varchar('anonymous_id', { length: 160 }),
  browserId: varchar('browser_id', { length: 160 }),
  sessionId: varchar('session_id', { length: 160 }),
  cartId: uuid('cart_id'),
  attributionId: uuid('attribution_id'),

  // Slice 3B: structured Uganda delivery location + fee provenance + idempotency
  deliveryLocation: jsonb('delivery_location'),
  deliveryFeeConfirmed: boolean('delivery_fee_confirmed').default(false).notNull(),
  clientOrderKey: varchar('client_order_key', { length: 80 }),
}, (table) => ({
  orderNumberIdx: index('orders_number_idx').on(table.orderNumber),
  clientOrderKeyIdx: uniqueIndex('orders_client_order_key_idx').on(table.clientOrderKey),
  anonymousIdx: index('orders_anonymous_idx').on(table.anonymousId),
  browserIdx: index('orders_browser_idx').on(table.browserId),
  sessionIdx: index('orders_session_idx').on(table.sessionId),
  cartIdx: index('orders_cart_idx').on(table.cartId),
  attributionIdx: index('orders_attribution_idx').on(table.attributionId),
}));

export const orderItems = pgTable('order_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => orders.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  sku: varchar('sku', { length: 50 }).notNull(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: integer('unit_price').notNull(),
});

export const cartsRelations = relations(carts, ({ many }) => ({
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, {
    fields: [cartItems.cartId],
    references: [carts.id],
  }),
  product: one(products, {
    fields: [cartItems.productId],
    references: [products.id],
  }),
}));

export const ordersRelations = relations(orders, ({ many }) => ({
  items: many(orderItems),
}));


export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

export const payments = pgTable('payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => orders.id).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).unique().notNull(),
  provider: varchar('provider', { length: 50 }).notNull(),
  providerReference: varchar('provider_reference', { length: 255 }),
  amount: integer('amount').notNull(),
  status: varchar('status', { length: 30 }).default('PENDING').notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const paymentAttempts = pgTable('payment_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => orders.id).notNull(),
  merchantReference: varchar('merchant_reference', { length: 255 }).unique().notNull(),
  orderTrackingId: varchar('order_tracking_id', { length: 255 }),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 10 }).default('UGX').notNull(),
  status: varchar('status', { length: 30 }).default('not_started').notNull(),
  redirectUrl: varchar('redirect_url', { length: 512 }),
  provider: varchar('provider', { length: 50 }).default('pesapal').notNull(),
  ipnReceivedAt: timestamp('ipn_received_at', { withTimezone: true }),
  callbackReceivedAt: timestamp('callback_received_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  trackingIdx: index('payments_tracking_idx').on(table.orderTrackingId),
  referenceIdx: index('payments_reference_idx').on(table.merchantReference),
}));



// Slice 3B: admin-configured delivery fee zones (per Ugandan district)
export const deliveryZones = pgTable('delivery_zones', {
  id: uuid('id').defaultRandom().primaryKey(),
  district: varchar('district', { length: 100 }).notNull(),
  feeUgx: integer('fee_ugx').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  districtIdx: uniqueIndex('delivery_zones_district_idx').on(table.district),
}));
