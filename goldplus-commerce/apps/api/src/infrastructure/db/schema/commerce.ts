import { pgTable, uuid, varchar, timestamp, integer, bigint, index, jsonb, boolean, uniqueIndex, customType } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/**
 * jsonb that survives the postgres-js driver. drizzle 0.29 + postgres-js
 * serialises a JS object into a JSON *string* parameter, which lands as a jsonb
 * STRING (jsonb_typeof = 'string') — the double-encoding defect live rows carry.
 * This type casts explicitly so objects land as objects. Scoped to
 * delivery_location only; other jsonb columns keep their historical behaviour
 * until their readers are audited.
 */
const jsonbStrict = customType<{ data: unknown; driverData: string }>({
  dataType() {
    return 'jsonb';
  },
  toDriver(value: unknown) {
    return sql`${JSON.stringify(value)}::jsonb` as unknown as string;
  },
});
import { products } from './products';
import { users } from './identity';

export const carts = pgTable('carts', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id'),
  sessionId: varchar('session_id', { length: 255 }),
  anonymousId: varchar('anonymous_id', { length: 160 }),
  // Ownership (migration 0060). Nullable because carts predating it cannot be
  // attributed retroactively — there is no record of who created them — and a
  // guessed owner would look like an authorization decision nobody made.
  ownerKind: varchar('owner_kind', { length: 8 }),
  ownerId: varchar('owner_id', { length: 128 }),
  /** Monotonic, for optimistic concurrency. See the migration for why. */
  version: integer('version').default(1).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => ({
  sessionIdx: index('carts_session_idx').on(table.sessionId),
  anonymousIdx: index('carts_anonymous_idx').on(table.anonymousId),
  ownerIdx: index('carts_owner_idx').on(table.ownerKind, table.ownerId),
}));

export const cartItems = pgTable('cart_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  cartId: uuid('cart_id').references(() => carts.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  quantity: integer('quantity').notNull(),
}, (table) => ({
  // One row per (cart, product), enforced by the database (migration 0060). The
  // repository's delete-then-reinsert hid the absence of this: nothing stopped two
  // rows for the same product silently doubling a line.
  cartProductIdx: uniqueIndex('cart_items_cart_product_idx').on(table.cartId, table.productId),
}));

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
  subtotalAmount: bigint('subtotal_amount', { mode: 'number' }).notNull(),
  deliveryFee: bigint('delivery_fee', { mode: 'number' }).notNull().default(0),
  totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
  // Pricing 0042: immutable authoritative quote provenance. Existing orders are
  // backfilled as unadjusted UGX snapshots; new checkout writes the exact quote.
  pricingQuoteId: uuid('pricing_quote_id'),
  pricingCurrency: varchar('pricing_currency', { length: 3 }).default('UGX').notNull(),
  pricingBaseSubtotal: bigint('pricing_base_subtotal', { mode: 'number' }).default(0).notNull(),
  pricingDiscountTotal: bigint('pricing_discount_total', { mode: 'number' }).default(0).notNull(),
  pricingTaxTotal: bigint('pricing_tax_total', { mode: 'number' }).default(0).notNull(),
  pricingCalculationVersion: varchar('pricing_calculation_version', { length: 40 }).default('legacy-unadjusted-v1').notNull(),
  pricingSnapshot: jsonb('pricing_snapshot'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

  // Pass 13A: Stitching context
  anonymousId: varchar('anonymous_id', { length: 160 }),
  browserId: varchar('browser_id', { length: 160 }),
  sessionId: varchar('session_id', { length: 160 }),
  cartId: uuid('cart_id'),
  attributionId: uuid('attribution_id'),

  // Slice 3B: structured Uganda delivery location + fee provenance + idempotency
  deliveryLocation: jsonbStrict('delivery_location'),
  deliveryFeeConfirmed: boolean('delivery_fee_confirmed').default(false).notNull(),
  // 0084: verbatim pre-normalisation copy of rows the double-encoding backfill
  // rewrote — reversibility for the encoding fix, never read by application code.
  deliveryLocationRaw: jsonb('delivery_location_raw'),
  // 0085: loyalty redemption applied to this order (discount is a recorded fact)
  loyaltyDiscountUgx: bigint('loyalty_discount_ugx', { mode: 'number' }).default(0).notNull(),
  loyaltyRedemptionId: uuid('loyalty_redemption_id'),
  clientOrderKey: varchar('client_order_key', { length: 80 }),
  // What actually happened to stock for this order (migration 0053). Recorded on
  // the order rather than inferred from a fulfilment task, so payment and
  // fulfilment can both fail closed on it.
  reservationState: varchar('reservation_state', { length: 24 })
    .default('PENDING')
    .notNull(),
  reservationUpdatedAt: timestamp('reservation_updated_at', { withTimezone: true }),
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
  unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
  canonicalUnitPrice: bigint('canonical_unit_price', { mode: 'number' }).default(0).notNull(),
  baseSubtotal: bigint('base_subtotal', { mode: 'number' }).default(0).notNull(),
  discountAmount: bigint('discount_amount', { mode: 'number' }).default(0).notNull(),
  finalLineTotal: bigint('final_line_total', { mode: 'number' }).default(0).notNull(),
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
  amount: bigint('amount', { mode: 'number' }).notNull(),
  status: varchar('status', { length: 30 }).default('PENDING').notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  // Was the webhook that created this payment authenticated? (migration 0056)
  // Recorded per payment so an unverified one stays distinguishable by query,
  // permanently — not by grepping logs that roll over.
  signatureVerified: boolean('signature_verified').default(true).notNull(),
  requiresReview: boolean('requires_review').default(false).notNull(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const paymentAttempts = pgTable('payment_attempts', {
  id: uuid('id').defaultRandom().primaryKey(),
  orderId: uuid('order_id').references(() => orders.id).notNull(),
  merchantReference: varchar('merchant_reference', { length: 255 }).unique().notNull(),
  orderTrackingId: varchar('order_tracking_id', { length: 255 }),
  amount: bigint('amount', { mode: 'number' }).notNull(),
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
  feeUgx: bigint('fee_ugx', { mode: 'number' }).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  districtIdx: uniqueIndex('delivery_zones_district_idx').on(table.district),
}));

/**
 * Delivery intelligence (migration 0083): the single band-pricing policy that
 * turns embedded road geography into countrywide fee ESTIMATES. Confirmed
 * zones above always override; estimates never enter order totals. Single-row
 * by construction — the fixed "singleton" key is unique.
 */
export const deliveryPricingPolicy = pgTable('delivery_pricing_policy', {
  id: uuid('id').defaultRandom().primaryKey(),
  singleton: varchar('singleton', { length: 10 }).default('policy').notNull(),
  coreFeeUgx: bigint('core_fee_ugx', { mode: 'number' }).notNull(),
  cityFeeUgx: bigint('city_fee_ugx', { mode: 'number' }).notNull(),
  metroFeeUgx: bigint('metro_fee_ugx', { mode: 'number' }).notNull(),
  metroEdgeFeeUgx: bigint('metro_edge_fee_ugx', { mode: 'number' }).notNull(),
  nearFeeUgx: bigint('near_fee_ugx', { mode: 'number' }).notNull(),
  midFeeUgx: bigint('mid_fee_ugx', { mode: 'number' }).notNull(),
  farFeeUgx: bigint('far_fee_ugx', { mode: 'number' }).notNull(),
  remoteFeeUgx: bigint('remote_fee_ugx', { mode: 'number' }).notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  note: varchar('note', { length: 300 }),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  singletonIdx: uniqueIndex('delivery_pricing_policy_singleton_idx').on(table.singleton),
}));

/**
 * Checkout idempotency (migration 0057).
 *
 * One row per (trusted principal, client order key), claimed atomically with
 * INSERT ... ON CONFLICT so two concurrent submissions cannot both perform
 * commerce work. The fingerprint makes "same key, materially different request"
 * detectable rather than silently answered with the earlier order.
 */
export const checkoutIdempotency = pgTable('checkout_idempotency', {
  identity: varchar('identity', { length: 64 }).primaryKey(),
  principalKey: varchar('principal_key', { length: 96 }).notNull(),
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  state: varchar('state', { length: 20 }).default('IN_PROGRESS').notNull(),
  orderId: uuid('order_id'),
  failureReason: varchar('failure_reason', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // Fenced lease (migration 0058). updated_at is not proof of ownership: after a
  // takeover the row is IN_PROGRESS again, so a late worker matched the old
  // predicate and could complete an operation it no longer owned.
  claimToken: varchar('claim_token', { length: 64 }),
  fencingNumber: integer('fencing_number').default(1).notNull(),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  attemptNumber: integer('attempt_number').default(1).notNull(),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  stage: varchar('stage', { length: 24 }).default('CLAIMED').notNull(),
  // Separated from `stage` in migration 0059. `stage` says where the saga got to;
  // this says whether the workflow is still running. Collapsing them is what
  // recorded an unpaid order as a completed checkout.
  operationState: varchar('operation_state', { length: 20 }).default('IN_PROGRESS').notNull(),
}, (table) => ({
  inProgressIdx: index('checkout_idempotency_in_progress_idx').on(table.updatedAt),
  principalIdx: index('checkout_idempotency_principal_idx').on(table.principalKey, table.createdAt),
}));

/**
 * Durable side-effect identities (migration 0059).
 *
 * One row per (checkout identity, event type), written in the SAME transaction as
 * the outbox event it creates. Before this, fulfilment and notification work ran
 * inside the request and a failure was merely reported to an observer while the
 * checkout carried on: if the process died after the order committed, the work was
 * gone and nothing recorded that it had ever been owed.
 */
export const checkoutSideEffects = pgTable('checkout_side_effects', {
  id: uuid('id').defaultRandom().primaryKey(),
  checkoutIdentity: varchar('checkout_identity', { length: 64 }).notNull(),
  orderId: uuid('order_id').notNull(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  policyVersion: varchar('policy_version', { length: 48 }).notNull(),
  /** The outbox row this created, so source and delivery reconcile. */
  outboxEventId: uuid('outbox_event_id'),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
  traceId: varchar('trace_id', { length: 128 }),
}, (table) => ({
  identityEventIdx: uniqueIndex('checkout_side_effects_identity_event_idx').on(
    table.checkoutIdentity,
    table.eventType,
  ),
  orderIdx: index('checkout_side_effects_order_idx').on(table.orderId),
}));

/**
 * P0-2 §5 — canonical append-only order-transition ledger.
 *
 * Exactly one row per committed status transition, written in the SAME
 * transaction as the order-status update. Append-only: no application update or
 * delete path exists, and an architecture test forbids one. Actor identity comes
 * from trusted context, never a request body. Backfill writes one explicit
 * synthetic snapshot per pre-existing order (is_synthetic=true), which asserts
 * the order HAD this stored state when history began — not that every transition
 * was observed. No raw PII / provider payloads / tokens are stored.
 */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id').references(() => orders.id).notNull(),
    fromStatus: varchar('from_status', { length: 30 }),
    toStatus: varchar('to_status', { length: 30 }).notNull(),
    actorId: uuid('actor_id'),
    actorType: varchar('actor_type', { length: 24 }).notNull(),
    reasonCode: varchar('reason_code', { length: 48 }),
    source: varchar('source', { length: 24 }).notNull(),
    note: varchar('note', { length: 500 }),
    idempotencyKey: varchar('idempotency_key', { length: 120 }),
    correlationId: varchar('correlation_id', { length: 120 }),
    isSynthetic: boolean('is_synthetic').notNull().default(false),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    orderOccurredIdx: index('order_events_order_occurred_idx').on(t.orderId, t.occurredAt),
  }),
);
