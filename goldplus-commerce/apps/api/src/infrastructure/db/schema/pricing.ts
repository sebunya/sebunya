import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { orders, orderItems } from './commerce';
import { experiments } from './experiments';

export const promotionDefinitions = pgTable('promotion_definitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: varchar('key', { length: 80 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  description: text('description').notNull(),
  status: varchar('status', { length: 30 }).notNull().default('DRAFT'),
  revision: integer('revision').notNull().default(1),
  activeVersionId: uuid('active_version_id'),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  keyIdx: uniqueIndex('promotion_definitions_key_idx').on(table.key),
  statusIdx: index('promotion_definitions_status_idx').on(table.status),
}));

export const promotionVersions = pgTable('promotion_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  definitionId: uuid('definition_id').notNull().references(() => promotionDefinitions.id),
  versionNumber: integer('version_number').notNull(),
  status: varchar('status', { length: 30 }).notNull().default('DRAFT'),
  conditions: jsonb('conditions').notNull(),
  benefits: jsonb('benefits').notNull(),
  exclusions: jsonb('exclusions').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  globalLimit: integer('global_limit'),
  perCustomerLimit: integer('per_customer_limit'),
  perCouponLimit: integer('per_coupon_limit'),
  reservationTtlSeconds: integer('reservation_ttl_seconds').notNull().default(900),
  priority: integer('priority').notNull().default(0),
  stackable: boolean('stackable').notNull().default(false),
  couponCode: varchar('coupon_code', { length: 40 }),
  priceFloorUgx: integer('price_floor_ugx').notNull().default(0),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: uuid('approved_by'),
}, (table) => ({
  versionIdx: uniqueIndex('promotion_versions_definition_number_idx').on(table.definitionId, table.versionNumber),
  couponIdx: index('promotion_versions_coupon_idx').on(table.couponCode),
  statusWindowIdx: index('promotion_versions_status_window_idx').on(table.status, table.startsAt, table.endsAt),
}));

export const promotionApprovals = pgTable('promotion_approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  versionId: uuid('version_id').notNull().references(() => promotionVersions.id),
  decision: varchar('decision', { length: 20 }).notNull(),
  actorId: uuid('actor_id').notNull(),
  reason: text('reason').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ versionIdx: index('promotion_approvals_version_idx').on(table.versionId, table.decidedAt) }));

export const pricingQuotes = pgTable('pricing_quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  currency: varchar('currency', { length: 3 }).notNull().default('UGX'),
  customerScopeHash: varchar('customer_scope_hash', { length: 64 }),
  couponReference: varchar('coupon_reference', { length: 64 }),
  baseSubtotalUgx: integer('base_subtotal_ugx').notNull(),
  discountTotalUgx: integer('discount_total_ugx').notNull().default(0),
  shippingUgx: integer('shipping_ugx').notNull().default(0),
  taxUgx: integer('tax_ugx').notNull().default(0),
  finalTotalUgx: integer('final_total_ugx').notNull(),
  calculationVersion: varchar('calculation_version', { length: 40 }).notNull(),
  experimentEvidence: jsonb('experiment_evidence').notNull(),
  decisionTrace: jsonb('decision_trace').notNull(),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (table) => ({ expiryIdx: index('pricing_quotes_expiry_idx').on(table.expiresAt) }));

export const pricingQuoteLines = pgTable('pricing_quote_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  quoteId: uuid('quote_id').notNull().references(() => pricingQuotes.id),
  productId: uuid('product_id').notNull(),
  sku: varchar('sku', { length: 50 }).notNull(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  quantity: integer('quantity').notNull(),
  canonicalUnitPriceUgx: integer('canonical_unit_price_ugx').notNull(),
  baseSubtotalUgx: integer('base_subtotal_ugx').notNull(),
  discountUgx: integer('discount_ugx').notNull().default(0),
  finalSubtotalUgx: integer('final_subtotal_ugx').notNull(),
}, (table) => ({ quoteProductIdx: uniqueIndex('pricing_quote_lines_quote_product_idx').on(table.quoteId, table.productId) }));

export const pricingAdjustments = pgTable('pricing_adjustments', {
  id: uuid('id').primaryKey().defaultRandom(),
  quoteId: uuid('quote_id').notNull().references(() => pricingQuotes.id),
  quoteLineId: uuid('quote_line_id').references(() => pricingQuoteLines.id),
  promotionDefinitionId: uuid('promotion_definition_id').notNull().references(() => promotionDefinitions.id),
  promotionVersionId: uuid('promotion_version_id').notNull().references(() => promotionVersions.id),
  benefitType: varchar('benefit_type', { length: 30 }).notNull(),
  amountUgx: integer('amount_ugx').notNull(),
  applicationOrder: integer('application_order').notNull(),
  explanation: text('explanation').notNull(),
}, (table) => ({ quoteIdx: index('pricing_adjustments_quote_idx').on(table.quoteId, table.applicationOrder) }));

export const promotionReservations = pgTable('promotion_reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  quoteId: uuid('quote_id').notNull().references(() => pricingQuotes.id),
  promotionVersionId: uuid('promotion_version_id').notNull().references(() => promotionVersions.id),
  customerScopeHash: varchar('customer_scope_hash', { length: 64 }),
  couponReferenceHash: varchar('coupon_reference_hash', { length: 64 }),
  idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('RESERVED'),
  reservedAt: timestamp('reserved_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idempotencyIdx: uniqueIndex('promotion_reservations_idempotency_idx').on(table.idempotencyKey, table.promotionVersionId),
  capacityIdx: index('promotion_reservations_capacity_idx').on(table.promotionVersionId, table.status, table.expiresAt),
  customerIdx: index('promotion_reservations_customer_idx').on(table.promotionVersionId, table.customerScopeHash, table.status),
  couponIdx: index('promotion_reservations_coupon_idx').on(table.promotionVersionId, table.couponReferenceHash, table.status),
}));

export const promotionRedemptions = pgTable('promotion_redemptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  reservationId: uuid('reservation_id').notNull().references(() => promotionReservations.id),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  reservationIdx: uniqueIndex('promotion_redemptions_reservation_idx').on(table.reservationId),
  orderVersionIdx: uniqueIndex('promotion_redemptions_order_reservation_idx').on(table.orderId, table.reservationId),
}));

export const pricingExperimentAssociations = pgTable('pricing_experiment_associations', {
  promotionVersionId: uuid('promotion_version_id').notNull().references(() => promotionVersions.id),
  experimentId: uuid('experiment_id').notNull().references(() => experiments.id),
  variantKey: varchar('variant_key', { length: 40 }).notNull(),
}, (table) => ({ associationIdx: uniqueIndex('pricing_experiment_associations_idx').on(table.promotionVersionId, table.experimentId, table.variantKey) }));

// Type-only anchors for the immutable order snapshot columns added by 0042.
export type PricingOrderAnchor = typeof orders.$inferSelect;
export type PricingOrderLineAnchor = typeof orderItems.$inferSelect;
