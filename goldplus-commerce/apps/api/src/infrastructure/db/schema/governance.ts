import { pgTable, uuid, varchar, timestamp, text, jsonb, index, integer, bigint, date, uniqueIndex, boolean } from 'drizzle-orm/pg-core';
import { products } from './products';

export const dealerApplications = pgTable('dealer_applications', {
  id: uuid('id').defaultRandom().primaryKey(),
  businessName: varchar('business_name', { length: 255 }).notNull(),
  contactName: varchar('contact_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }).notNull(),
  tinNumber: varchar('tin_number', { length: 50 }).notNull(),
  location: varchar('location', { length: 512 }).notNull(),

  experience: text('experience'),
  status: varchar('status', { length: 50 }).default('pending').notNull(), // pending, under_review, approved, rejected
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

  // Pass 13A: Stitching context
  anonymousId: varchar('anonymous_id', { length: 160 }),
  browserId: varchar('browser_id', { length: 160 }),
  sessionId: varchar('session_id', { length: 160 }),
  attributionId: uuid('attribution_id'),
}, (table) => ({
  anonymousIdx: index('dealer_applications_anonymous_idx').on(table.anonymousId),
  browserIdx: index('dealer_applications_browser_idx').on(table.browserId),
  sessionIdx: index('dealer_applications_session_idx').on(table.sessionId),
  attributionIdx: index('dealer_applications_attribution_idx').on(table.attributionId),
}));

export const quoteRequests = pgTable('quote_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerName: varchar('customer_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }).notNull(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  quantity: varchar('quantity', { length: 50 }).notNull(),
  message: text('message'),
  status: varchar('status', { length: 50 }).default('new').notNull(), // new, quoted, lost, won
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

  // Pass 13A: Stitching context
  anonymousId: varchar('anonymous_id', { length: 160 }),
  browserId: varchar('browser_id', { length: 160 }),
  sessionId: varchar('session_id', { length: 160 }),
  cartId: uuid('cart_id'),
  attributionId: uuid('attribution_id'),

  // 0153: bulk quote requests (docs/bulk-buying/DESIGN.md). All nullable or
  // defaulted: a legacy single-product row leaves them empty.
  reference: varchar('reference', { length: 16 }),
  idempotencyKey: varchar('idempotency_key', { length: 80 }),
  requestFingerprint: varchar('request_fingerprint', { length: 64 }),
  source: varchar('source', { length: 24 }).default('form').notNull(),
  buyerType: varchar('buyer_type', { length: 20 }),
  businessName: varchar('business_name', { length: 160 }),
  deliveryDistrict: varchar('delivery_district', { length: 80 }),
  neededBy: date('needed_by'),
  lineCount: integer('line_count'),
  totalUnits: bigint('total_units', { mode: 'number' }),
  estimatedTotalUgx: bigint('estimated_total_ugx', { mode: 'number' }),
  pricedLineCount: integer('priced_line_count'),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  // 0195: what the buyer can spend (may come with no lines: the team builds the
  // list), and whether they were shown dealer prices (phone verified by code).
  budgetUgx: bigint('budget_ugx', { mode: 'number' }),
  pricesShown: boolean('prices_shown').default(false).notNull(),
}, (table) => ({
  referenceUq: uniqueIndex('quote_requests_reference_uq').on(table.reference),
  idempotencyUq: uniqueIndex('quote_requests_idempotency_key_uq').on(table.idempotencyKey),
  anonymousIdx: index('quote_requests_anonymous_idx').on(table.anonymousId),
  browserIdx: index('quote_requests_browser_idx').on(table.browserId),
  sessionIdx: index('quote_requests_session_idx').on(table.sessionId),
  cartIdx: index('quote_requests_cart_idx').on(table.cartId),
  attributionIdx: index('quote_requests_attribution_idx').on(table.attributionId),
}));

/** 0153: one row per product on a bulk quote request; name/code/price are snapshots. */
export const quoteRequestLines = pgTable('quote_request_lines', {
  id: uuid('id').defaultRandom().primaryKey(),
  quoteRequestId: uuid('quote_request_id').notNull().references(() => quoteRequests.id, { onDelete: 'cascade' }),
  lineNo: integer('line_no').notNull(),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  productCode: varchar('product_code', { length: 120 }),
  productName: varchar('product_name', { length: 255 }).notNull(),
  /** Total pieces; NULL when the line is in cartons of a size not yet entered (0195). */
  quantity: integer('quantity'),
  unitPriceUgx: bigint('unit_price_ugx', { mode: 'number' }),
  lineTotalUgx: bigint('line_total_ugx', { mode: 'number' }),
  availability: varchar('availability', { length: 16 }).default('unknown').notNull(),
  // 0195: what the buyer chose (cartons or pieces, how many) and the carton
  // size then; unit_price_ugx is the dealer price per piece ('dealer') on new
  // lines, the public list price ('list') on lines from before 0195.
  unitKind: varchar('unit_kind', { length: 8 }).default('piece').notNull(),
  unitCount: integer('unit_count'),
  unitsPerCarton: integer('units_per_carton'),
  priceBasis: varchar('price_basis', { length: 8 }).default('list').notNull(),
  aboveSelfServe: boolean('above_self_serve').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  requestIdx: index('quote_request_lines_request_idx').on(table.quoteRequestId),
  lineNoUq: uniqueIndex('quote_request_lines_line_no_uq').on(table.quoteRequestId, table.lineNo),
  productUq: uniqueIndex('quote_request_lines_product_uq').on(table.quoteRequestId, table.productId),
}));

export const supportIssues = pgTable('support_issues', {
  id: uuid('id').defaultRandom().primaryKey(),
  customerId: uuid('customer_id'),
  subject: varchar('subject', { length: 255 }).notNull(),
  description: text('description').notNull(),
  status: varchar('status', { length: 50 }).default('open').notNull(), // open, in-progress, resolved, closed
  priority: varchar('priority', { length: 50 }).default('medium').notNull(), // low, medium, high, urgent
  type: varchar('type', { length: 50 }).notNull(), // issue, fake_report, inquiry
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

  // Slice 11: inbox operations
  assignedTo: varchar('assigned_to', { length: 120 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});


export const fakeProductReports = pgTable('fake_product_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  reporterName: varchar('reporter_name', { length: 255 }),
  reporterContact: varchar('reporter_contact', { length: 255 }),
  locationFound: varchar('location_found', { length: 255 }).notNull(),
  productDescription: text('product_description').notNull(),
  hologramCode: varchar('hologram_code', { length: 100 }),
  evidenceUrls: jsonb('evidence_urls').$type<string[]>().default([]),
  status: varchar('status', { length: 50 }).default('new').notNull(), // new, investigating, verified_fake, dismissed
  /** 0087: a signed-in reporter is attributable and earns on confirmation. */
  reporterUserId: uuid('reporter_user_id'),
  loyaltyEntryId: uuid('loyalty_entry_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * 0195: SMS code challenges for seeing bulk dealer prices. A verified row is
 * also the record of which phone looked, and when.
 */
export const bulkPriceAccess = pgTable('bulk_price_access', {
  id: uuid('id').defaultRandom().primaryKey(),
  phone: varchar('phone', { length: 20 }).notNull(),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  /** 'first_visit': the number was typed, not proved (no code the first time); 'code': proved by SMS. */
  method: varchar('method', { length: 12 }).default('code').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  phoneCreatedIdx: index('bulk_price_access_phone_created_idx').on(table.phone, table.createdAt),
}));
