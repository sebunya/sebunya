import { sql } from 'drizzle-orm';
import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { orders } from './commerce';

/**
 * U4 — creator platform (CRM, attribution, commission, payout). Built for Uganda:
 * MoMo/Airtel payouts, withholding tax, COD-gated commission, WhatsApp.
 *
 * Identity is stored as peppered hashes only — raw phone/email/address never
 * persisted in fraud evidence. Creator coupon codes extend U1's coupon_codes
 * (code_type='creator', assigned_to_creator_id). Mobile-money disbursement is a
 * NO-SEND port in this programme; withholding rates are effective-dated config.
 */
export const creators = pgTable('creators', {
  id: uuid('id').primaryKey().defaultRandom(),
  handle: varchar('handle', { length: 80 }).notNull(),
  legalName: varchar('legal_name', { length: 160 }),
  phoneHash: varchar('phone_hash', { length: 64 }),
  emailHash: varchar('email_hash', { length: 64 }),
  whatsappNumberHash: varchar('whatsapp_number_hash', { length: 64 }),
  primaryPlatform: varchar('primary_platform', { length: 40 }),
  tier: varchar('tier', { length: 12 }), // nano|micro|mid|macro|celebrity
  nicheTags: text('niche_tags').array().notNull().default([]),
  languages: text('languages').array().notNull().default([]),
  locationDistrict: varchar('location_district', { length: 80 }),
  status: varchar('status', { length: 16 }).notNull().default('prospect'),
  ownerAdminId: uuid('owner_admin_id'),
  source: varchar('source', { length: 80 }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  handleIdx: uniqueIndex('creators_handle_idx').on(table.handle),
  phoneIdx: index('creators_phone_hash_idx').on(table.phoneHash),
  statusIdx: index('creators_status_idx').on(table.status),
}));

export const creatorContracts = pgTable('creator_contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  creatorId: uuid('creator_id').notNull().references(() => creators.id),
  campaignId: uuid('campaign_id'),
  contractType: varchar('contract_type', { length: 20 }).notNull(),
  flatFeeUgx: bigint('flat_fee_ugx', { mode: 'number' }),
  commissionRateBps: integer('commission_rate_bps'),
  commissionCapUgx: bigint('commission_cap_ugx', { mode: 'number' }),
  usageRightsScope: varchar('usage_rights_scope', { length: 16 }),
  usageRightsExpiry: date('usage_rights_expiry'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  status: varchar('status', { length: 16 }).notNull().default('draft'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  documentUrl: varchar('document_url', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ creatorIdx: index('creator_contracts_creator_idx').on(table.creatorId, table.status) }));

export const creatorLinks = pgTable('creator_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  creatorId: uuid('creator_id').notNull().references(() => creators.id),
  campaignId: uuid('campaign_id'),
  shortCode: varchar('short_code', { length: 20 }).notNull(),
  destinationUrl: varchar('destination_url', { length: 500 }).notNull(),
  utmParams: jsonb('utm_params').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ shortCodeIdx: uniqueIndex('creator_links_short_code_idx').on(table.shortCode) }));

export const creatorLinkClicks = pgTable('creator_link_clicks', {
  id: uuid('id').primaryKey().defaultRandom(),
  linkId: uuid('link_id').notNull().references(() => creatorLinks.id),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  ipHash: varchar('ip_hash', { length: 64 }),
  userAgentHash: varchar('user_agent_hash', { length: 64 }),
  referrer: varchar('referrer', { length: 300 }),
  country: varchar('country', { length: 2 }),
  deviceType: varchar('device_type', { length: 20 }),
  anonymousId: varchar('anonymous_id', { length: 80 }),
  isSuspectedBot: boolean('is_suspected_bot').notNull().default(false),
}, (table) => ({ linkOccurredIdx: index('creator_link_clicks_link_occurred_idx').on(table.linkId, table.occurredAt) }));

export const creatorAttributions = pgTable('creator_attributions', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  creatorId: uuid('creator_id').notNull().references(() => creators.id),
  mechanism: varchar('mechanism', { length: 8 }).notNull(), // code|link|survey
  confidence: varchar('confidence', { length: 8 }).notNull(), // high|medium|low
  attributedRevenueUgx: bigint('attributed_revenue_ugx', { mode: 'number' }).notNull().default(0),
  isPrimary: boolean('is_primary').notNull().default(false),
  attributedAt: timestamp('attributed_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  creatorIdx: index('creator_attributions_creator_idx').on(table.creatorId, table.attributedAt),
  // At most one attribution per (order, creator, mechanism); recomputable, no double-count.
  orderCreatorMechIdx: uniqueIndex('creator_attributions_order_creator_mech_idx').on(table.orderId, table.creatorId, table.mechanism),
  // Exactly one primary attribution per order.
  orderPrimaryIdx: uniqueIndex('creator_attributions_order_primary_idx').on(table.orderId).where(sql`is_primary`),
}));

export const creatorCommissions = pgTable('creator_commissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  creatorId: uuid('creator_id').notNull().references(() => creators.id),
  orderId: uuid('order_id').notNull().references(() => orders.id),
  contractId: uuid('contract_id').references(() => creatorContracts.id),
  grossRevenueUgx: bigint('gross_revenue_ugx', { mode: 'number' }).notNull(),
  commissionableRevenueUgx: bigint('commissionable_revenue_ugx', { mode: 'number' }).notNull(),
  commissionRateBps: integer('commission_rate_bps').notNull(),
  commissionAmountUgx: bigint('commission_amount_ugx', { mode: 'number' }).notNull(),
  status: varchar('status', { length: 12 }).notNull().default('pending'), // pending|approved|held|reversed|paid
  holdUntil: timestamp('hold_until', { withTimezone: true }),
  reversedReason: varchar('reversed_reason', { length: 160 }),
  payoutId: uuid('payout_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orderCreatorIdx: uniqueIndex('creator_commissions_order_creator_idx').on(table.orderId, table.creatorId),
  statusIdx: index('creator_commissions_status_idx').on(table.status, table.holdUntil),
}));

export const creatorPayouts = pgTable('creator_payouts', {
  id: uuid('id').primaryKey().defaultRandom(),
  creatorId: uuid('creator_id').notNull().references(() => creators.id),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  grossAmountUgx: bigint('gross_amount_ugx', { mode: 'number' }).notNull(),
  withholdingTaxUgx: bigint('withholding_tax_ugx', { mode: 'number' }).notNull(),
  netAmountUgx: bigint('net_amount_ugx', { mode: 'number' }).notNull(),
  withholdingRateBps: integer('withholding_rate_bps').notNull(),
  method: varchar('method', { length: 16 }), // mtn_momo|airtel_money|bank_transfer
  destinationMasked: varchar('destination_masked', { length: 40 }),
  status: varchar('status', { length: 12 }).notNull().default('draft'),
  createdBy: uuid('created_by').notNull(),
  approvedBy: uuid('approved_by'),
  idempotencyKey: varchar('idempotency_key', { length: 120 }).notNull(),
  initiatedAt: timestamp('initiated_at', { withTimezone: true }),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  providerReference: varchar('provider_reference', { length: 160 }),
  failureReason: varchar('failure_reason', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  idempotencyIdx: uniqueIndex('creator_payouts_idempotency_idx').on(table.idempotencyKey),
  creatorPeriodIdx: index('creator_payouts_creator_period_idx').on(table.creatorId, table.periodStart),
}));

export const creatorContentAssets = pgTable('creator_content_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  creatorId: uuid('creator_id').notNull().references(() => creators.id),
  deliverableId: uuid('deliverable_id'),
  assetType: varchar('asset_type', { length: 24 }).notNull(),
  storageUrl: varchar('storage_url', { length: 500 }).notNull(),
  thumbnailUrl: varchar('thumbnail_url', { length: 500 }),
  platformPublishedUrl: varchar('platform_published_url', { length: 500 }),
  rightsScope: varchar('rights_scope', { length: 16 }),
  rightsExpiry: date('rights_expiry'),
  approvedForAds: boolean('approved_for_ads').notNull().default(false),
  performanceMetrics: jsonb('performance_metrics').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({ creatorIdx: index('creator_content_assets_creator_idx').on(table.creatorId) }));
