import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { products } from './products';
import { mediaAssets } from './media';
import { deviceBrands, deviceSeries, devices } from './devices';

/**
 * Battery catalogue, inventory ledger, staged imports and finder demand (0125).
 *
 * One physical battery SKU = one `products` row (there are no variants in this
 * codebase) + one `battery_profiles` row + many `battery_aliases` + many
 * `product_device_compatibility` rows (schema/devices.ts). CHECK constraints
 * live in the hand-written migration; the definitions below mirror it for the
 * query builder. Nothing here invents a specification, a quantity or a price:
 * every column that cannot be sourced is nullable and stays null.
 */

export const batteryProfiles = pgTable('battery_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id),
  canonicalCode: varchar('canonical_code', { length: 80 }).notNull(),
  canonicalCodeNormalised: varchar('canonical_code_normalised', { length: 80 }).notNull(),
  codeStatus: text('code_status').notNull().default('PROVISIONAL'), // CONFIRMED | PROVISIONAL | DEVICE_NAMED | MISSING
  supplierCode: varchar('supplier_code', { length: 120 }),
  barcode: varchar('barcode', { length: 64 }),
  batteryCategory: text('battery_category').notNull().default('PHONE'), // PHONE | MIFI_ROUTER | OTHER
  chemistry: text('chemistry'), // LI_ION | LI_POLYMER | NIMH | OTHER
  nominalVoltageMv: integer('nominal_voltage_mv'),
  capacityMah: integer('capacity_mah'),
  wattHours: numeric('watt_hours', { precision: 7, scale: 2 }),
  lengthMm: numeric('length_mm', { precision: 6, scale: 2 }),
  widthMm: numeric('width_mm', { precision: 6, scale: 2 }),
  thicknessMm: numeric('thickness_mm', { precision: 6, scale: 2 }),
  weightG: numeric('weight_g', { precision: 7, scale: 2 }),
  connectorNotes: varchar('connector_notes', { length: 300 }),
  warrantyMonths: integer('warranty_months'),
  supplierName: varchar('supplier_name', { length: 160 }),
  supplierReference: varchar('supplier_reference', { length: 160 }),
  packagingNotes: text('packaging_notes'),
  safetyNotes: text('safety_notes'),
  internalNotes: text('internal_notes'),
  publicNotes: text('public_notes'),
  lifecycleStatus: text('lifecycle_status').notNull().default('DRAFT'), // DRAFT | REVIEW | READY | ACTIVE | ARCHIVED
  verificationStatus: text('verification_status').notNull().default('UNVERIFIED'), // UNVERIFIED | VERIFIED
  verifiedBy: uuid('verified_by'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  publishedBy: uuid('published_by'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  sourceImportSessionId: uuid('source_import_session_id'),
  sourceReference: varchar('source_reference', { length: 200 }),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  productIdx: uniqueIndex('battery_profiles_product_idx').on(t.productId),
  // NB: the code and barcode unique indexes in the migration are PARTIAL
  // (non-archived rows only); the query builder only needs the plain indexes.
  lifecycleIdx: index('battery_profiles_lifecycle_idx').on(t.lifecycleStatus, t.batteryCategory),
}));

export const batteryAliases = pgTable('battery_aliases', {
  id: uuid('id').primaryKey().defaultRandom(),
  batteryProductId: uuid('battery_product_id').notNull().references(() => products.id),
  alias: varchar('alias', { length: 120 }).notNull(),
  aliasNormalised: varchar('alias_normalised', { length: 120 }).notNull(),
  aliasType: text('alias_type').notNull().default('SEARCH'), // CANONICAL | SUPPLIER | BARCODE | CUSTOMER | LEGACY | SEARCH | DEVICE_NAME
  source: varchar('source', { length: 200 }),
  verificationStatus: text('verification_status').notNull().default('UNVERIFIED'),
  isActive: boolean('is_active').notNull().default(true),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  productIdx: index('battery_aliases_product_idx').on(t.batteryProductId),
}));

export const batteryEvidenceAssets = pgTable('battery_evidence_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectType: text('subject_type').notNull(), // BATTERY | COMPATIBILITY
  subjectId: uuid('subject_id').notNull(),
  assetId: uuid('asset_id').notNull().references(() => mediaAssets.id),
  kind: text('kind').notNull().default('OTHER'), // FRONT | BACK | LABEL | CONNECTOR | PACKAGING | BARCODE | FIT_TEST | DOCUMENT | OTHER
  note: varchar('note', { length: 300 }),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  subjectIdx: index('battery_evidence_subject_idx').on(t.subjectType, t.subjectId),
}));

export const batteryFinderEvents = pgTable('battery_finder_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  eventType: text('event_type').notNull(), // SEARCH | DEVICE_SELECTED | RESULT_VIEWED | PRODUCT_VIEWED | ADDED_TO_CART | REQUEST_SUBMITTED
  mode: text('mode').notNull(), // FIND_BY_PHONE | SEARCH_CODE | PRODUCT_PAGE | CART
  queryNormalised: varchar('query_normalised', { length: 120 }),
  outcome: text('outcome').notNull().default('NONE'),
  brandId: uuid('brand_id').references(() => deviceBrands.id, { onDelete: 'set null' }),
  seriesId: uuid('series_id').references(() => deviceSeries.id, { onDelete: 'set null' }),
  deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
  batteryProductId: uuid('battery_product_id').references(() => products.id, { onDelete: 'set null' }),
  resultCount: integer('result_count').notNull().default(0),
  aliasHit: boolean('alias_hit').notNull().default(false),
  sessionHash: varchar('session_hash', { length: 64 }),
}, (t) => ({
  occurredIdx: index('battery_finder_events_occurred_idx').on(t.occurredAt),
  queryIdx: index('battery_finder_events_query_idx').on(t.queryNormalised, t.outcome),
  deviceIdx: index('battery_finder_events_device_idx').on(t.deviceId, t.eventType),
}));

export const batteryRequests = pgTable('battery_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  source: text('source').notNull().default('FINDER_NO_RESULT'), // FINDER_NO_RESULT | PRODUCT_PAGE | ADMIN
  queryText: varchar('query_text', { length: 200 }),
  queryNormalised: varchar('query_normalised', { length: 120 }),
  brandText: varchar('brand_text', { length: 80 }),
  deviceText: varchar('device_text', { length: 120 }),
  modelNumberText: varchar('model_number_text', { length: 80 }),
  batteryCodeText: varchar('battery_code_text', { length: 120 }),
  contactName: varchar('contact_name', { length: 120 }),
  contactPhone: varchar('contact_phone', { length: 32 }),
  notes: varchar('notes', { length: 1000 }),
  status: text('status').notNull().default('OPEN'), // OPEN | MAPPED_DEVICE | ALIAS_ADDED | BATTERY_MAPPED | DRAFT_CREATED | INVALID | RESOLVED
  resolutionNote: varchar('resolution_note', { length: 500 }),
  resolvedDeviceId: uuid('resolved_device_id').references(() => devices.id, { onDelete: 'set null' }),
  resolvedAliasId: uuid('resolved_alias_id').references(() => batteryAliases.id, { onDelete: 'set null' }),
  resolvedBatteryProductId: uuid('resolved_battery_product_id').references(() => products.id, { onDelete: 'set null' }),
  resolvedBy: uuid('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  sessionHash: varchar('session_hash', { length: 64 }),
}, (t) => ({
  statusIdx: index('battery_requests_status_idx').on(t.status, t.createdAt),
  queryIdx: index('battery_requests_query_idx').on(t.queryNormalised),
}));

// ---------------------------------------------------------------------------
// Inventory ledger
// ---------------------------------------------------------------------------
export const stockLocations = pgTable('stock_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 20 }).notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  status: text('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  codeIdx: uniqueIndex('stock_locations_code_idx').on(t.code),
}));

export const stockReceipts = pgTable('stock_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierName: varchar('supplier_name', { length: 160 }).notNull(),
  supplierReference: varchar('supplier_reference', { length: 120 }),
  locationId: uuid('location_id').references(() => stockLocations.id),
  status: text('status').notNull().default('DRAFT'), // DRAFT | APPLIED | CANCELLED
  notes: varchar('notes', { length: 1000 }),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  appliedBy: uuid('applied_by'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  cancelledBy: uuid('cancelled_by'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('stock_receipts_status_idx').on(t.status, t.createdAt),
}));

export const stockReceiptLines = pgTable('stock_receipt_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiptId: uuid('receipt_id').notNull().references(() => stockReceipts.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').references(() => products.id),
  scannedCode: varchar('scanned_code', { length: 120 }),
  matchKind: text('match_kind').notNull().default('EXISTING'), // EXISTING | NEW | AMBIGUOUS
  quantity: integer('quantity').notNull(),
  unitCostUgx: integer('unit_cost_ugx'),
  notes: varchar('notes', { length: 300 }),
  movementId: uuid('movement_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  receiptIdx: index('stock_receipt_lines_receipt_idx').on(t.receiptId),
}));

export const stockCounts = pgTable('stock_counts', {
  id: uuid('id').primaryKey().defaultRandom(),
  countType: text('count_type').notNull().default('CYCLE'), // CYCLE | FULL
  locationId: uuid('location_id').references(() => stockLocations.id),
  status: text('status').notNull().default('DRAFT'), // DRAFT | APPLIED | CANCELLED
  notes: varchar('notes', { length: 1000 }),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  appliedBy: uuid('applied_by'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  cancelledBy: uuid('cancelled_by'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index('stock_counts_status_idx').on(t.status, t.createdAt),
}));

export const stockCountLines = pgTable('stock_count_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  countId: uuid('count_id').notNull().references(() => stockCounts.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id),
  systemQuantity: integer('system_quantity').notNull(),
  countedQuantity: integer('counted_quantity').notNull(),
  reason: varchar('reason', { length: 300 }),
  movementId: uuid('movement_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  productIdx: uniqueIndex('stock_count_lines_product_idx').on(t.countId, t.productId),
}));

export const inventoryMovements = pgTable('inventory_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id),
  locationId: uuid('location_id').references(() => stockLocations.id),
  movementType: text('movement_type').notNull(), // OPENING | RECEIPT | COUNT | ADJUSTMENT | DAMAGED | LOST | RETURN | CORRECTION
  quantityDelta: integer('quantity_delta').notNull(),
  quantityBefore: integer('quantity_before').notNull(),
  quantityAfter: integer('quantity_after').notNull(),
  reason: varchar('reason', { length: 500 }).notNull(),
  supplierName: varchar('supplier_name', { length: 160 }),
  referenceNumber: varchar('reference_number', { length: 120 }),
  // Supplier cost: never returned by a public API (CLAUDE.md).
  unitCostUgx: integer('unit_cost_ugx'),
  receiptId: uuid('receipt_id').references(() => stockReceipts.id, { onDelete: 'set null' }),
  countId: uuid('count_id').references(() => stockCounts.id, { onDelete: 'set null' }),
  importSessionId: uuid('import_session_id'),
  actorId: uuid('actor_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  productIdx: index('inventory_movements_product_idx').on(t.productId, t.occurredAt),
  occurredIdx: index('inventory_movements_occurred_idx').on(t.occurredAt),
  receiptIdx: index('inventory_movements_receipt_idx').on(t.receiptId),
}));

// ---------------------------------------------------------------------------
// Staged spreadsheet imports
// ---------------------------------------------------------------------------
export const batteryImportMappingTemplates = pgTable('battery_import_mapping_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  importType: text('import_type').notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  mapping: jsonb('mapping').notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  nameIdx: uniqueIndex('battery_import_templates_name_idx').on(t.importType, t.name),
}));

export const batteryImportSessions = pgTable('battery_import_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  importType: text('import_type').notNull(), // BATTERY_CATALOGUE | COMPATIBILITY | STOCK_RECEIPT | STOCK_COUNT | PRICE_UPDATE
  name: varchar('name', { length: 160 }).notNull(),
  sourceFilename: varchar('source_filename', { length: 255 }).notNull(),
  sourceSha256: varchar('source_sha256', { length: 64 }).notNull(),
  sourceSheet: varchar('source_sheet', { length: 120 }),
  sourceColumns: jsonb('source_columns').notNull().default([]),
  status: text('status').notNull().default('UPLOADED'),
  version: integer('version').notNull().default(1),
  mapping: jsonb('mapping'),
  mappingTemplateId: uuid('mapping_template_id').references(() => batteryImportMappingTemplates.id, { onDelete: 'set null' }),
  totalRows: integer('total_rows').notNull().default(0),
  validRows: integer('valid_rows').notNull().default(0),
  invalidRows: integer('invalid_rows').notNull().default(0),
  heldRows: integer('held_rows').notNull().default(0),
  excludedRows: integer('excluded_rows').notNull().default(0),
  appliedRows: integer('applied_rows').notNull().default(0),
  failedRows: integer('failed_rows').notNull().default(0),
  previewDigest: varchar('preview_digest', { length: 64 }),
  rollbackInfo: jsonb('rollback_info'),
  createdBy: uuid('created_by').notNull(),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  appliedBy: uuid('applied_by'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sourceIdx: uniqueIndex('battery_import_sessions_source_idx').on(t.importType, t.sourceSha256),
  statusIdx: index('battery_import_sessions_status_idx').on(t.status, t.createdAt),
}));

export const batteryImportRows = pgTable('battery_import_rows', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => batteryImportSessions.id, { onDelete: 'cascade' }),
  rowNumber: integer('row_number').notNull(),
  rowKey: varchar('row_key', { length: 200 }),
  sourceData: jsonb('source_data').notNull(),
  normalizedData: jsonb('normalized_data'),
  proposedAction: varchar('proposed_action', { length: 40 }).notNull().default('PENDING'),
  validationWarnings: jsonb('validation_warnings').notNull().default([]),
  validationErrors: jsonb('validation_errors').notNull().default([]),
  status: text('status').notNull().default('PENDING'), // PENDING | VALID | INVALID | HELD | EXCLUDED | APPLIED | SKIPPED | FAILED | ROLLED_BACK
  resolution: varchar('resolution', { length: 40 }),
  resolutionNote: varchar('resolution_note', { length: 500 }),
  resolvedBy: uuid('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  appliedRecordIds: jsonb('applied_record_ids'),
  beforeSnapshot: jsonb('before_snapshot'),
  afterSnapshot: jsonb('after_snapshot'),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
  error: text('error'),
}, (t) => ({
  rowIdx: uniqueIndex('battery_import_rows_session_row_idx').on(t.sessionId, t.rowNumber),
  statusIdx: index('battery_import_rows_status_idx').on(t.sessionId, t.status),
}));

export const batteryImportEvents = pgTable('battery_import_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => batteryImportSessions.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 40 }).notNull(),
  actorId: uuid('actor_id').notNull(),
  reason: text('reason').notNull(),
  evidence: jsonb('evidence').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index('battery_import_events_session_idx').on(t.sessionId, t.createdAt),
}));

/** Admin-owned finder copy and ordering rules: one JSONB document, singleton row. */
export const batteryFinderConfig = pgTable('battery_finder_config', {
  id: boolean('id').default(true).primaryKey(),
  config: jsonb('config').default({}).notNull(),
  version: integer('version').default(1).notNull(),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
