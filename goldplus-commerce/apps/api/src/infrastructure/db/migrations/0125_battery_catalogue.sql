-- Battery catalogue, device hierarchy, compatibility workflow, inventory ledger,
-- staged battery imports and finder demand (0125).
--
-- WHY
-- GoldPlus sells one physical battery SKU that fits many phones. Customers think
-- device first ("a battery for my Tecno Spark 8"); the shop operates SKU first
-- ("BL-49FT is one product, one price, one stock balance"). Nothing in the schema
-- held that shape: `devices` (0070) was a flat brand+model list with no HTTP
-- surface, `product_device_compatibility` had no workflow, `seo_battery_compat`
-- (0119) duplicated brand/model as free text, stock had no ledger and no
-- location, and there was no way to import a spreadsheet without code.
--
-- This migration is ADDITIVE. It extends the two existing tables that already
-- model the right relationship (`devices`, `product_device_compatibility`) and
-- adds: device brands and series, a 1:1 battery profile on products, aliases,
-- evidence assets, a finder event stream and a battery request queue, stock
-- locations and an inventory movement ledger with receipts and counts, a staged
-- import pipeline, and one JSONB singleton for admin-owned finder copy.
--
-- Nothing is seeded here. Default rows (stock location, finder copy) are
-- inserted add-only at API boot; battery data arrives through the importer as
-- drafts and review items. No specification, quantity or price is invented.
--
-- MIGRATION_REQUIRED=true: the existing tables cannot express brand/series
-- hierarchy, exact model numbers, evidence levels, publication state, or a stock
-- movement, and `seo_battery_compat` has no device or product hierarchy to join.
--
-- LOCK RISK: additive only. The ALTERs touch `devices` and
-- `product_device_compatibility`, both with 0 rows in production on 2026-08-26,
-- so the index swap and the new CHECKs are instantaneous. Safe online.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Device hierarchy: brand -> series -> exact model
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(60) NOT NULL,
  name_normalised varchar(60) NOT NULL,
  slug varchar(80) NOT NULL,
  search_aliases text[] NOT NULL DEFAULT '{}',
  search_aliases_normalised text[] NOT NULL DEFAULT '{}',
  logo_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  is_featured boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_brands_status_chk CHECK (status IN ('ACTIVE','ARCHIVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS device_brands_slug_idx ON device_brands (slug);
CREATE UNIQUE INDEX IF NOT EXISTS device_brands_name_idx ON device_brands (name_normalised);
CREATE INDEX IF NOT EXISTS device_brands_order_idx ON device_brands (status, is_featured, display_order);

CREATE TABLE IF NOT EXISTS device_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES device_brands(id),
  name varchar(80) NOT NULL,
  name_normalised varchar(80) NOT NULL,
  slug varchar(100) NOT NULL,
  search_aliases text[] NOT NULL DEFAULT '{}',
  search_aliases_normalised text[] NOT NULL DEFAULT '{}',
  display_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_series_status_chk CHECK (status IN ('ACTIVE','ARCHIVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS device_series_brand_name_idx ON device_series (brand_id, name_normalised);
CREATE UNIQUE INDEX IF NOT EXISTS device_series_brand_slug_idx ON device_series (brand_id, slug);
CREATE INDEX IF NOT EXISTS device_series_order_idx ON device_series (brand_id, status, display_order);

-- `devices` (0070) keeps every existing column. The marketing name stays in
-- `model`; the exact technical model number and regional variant get their own
-- columns so "Galaxy A32 5G" and "SM-A326B" are never conflated.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES device_brands(id),
  ADD COLUMN IF NOT EXISTS series_id uuid REFERENCES device_series(id),
  ADD COLUMN IF NOT EXISTS model_number varchar(80),
  ADD COLUMN IF NOT EXISTS model_number_normalised varchar(80),
  ADD COLUMN IF NOT EXISTS variant varchar(80),
  ADD COLUMN IF NOT EXISTS variant_normalised varchar(80),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS merged_into_device_id uuid REFERENCES devices(id),
  ADD COLUMN IF NOT EXISTS source_reference varchar(200),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devices_status_chk') THEN
    ALTER TABLE devices ADD CONSTRAINT devices_status_chk CHECK (status IN ('ACTIVE','ARCHIVED','MERGED'));
  END IF;
END $$;

-- One marketing name may carry several exact model numbers or regional variants,
-- so the 0070 identity (brand, model) is replaced by (brand, model, model number,
-- variant). The table is empty in production; the swap is free.
DROP INDEX IF EXISTS devices_brand_model_idx;
CREATE UNIQUE INDEX IF NOT EXISTS devices_identity_idx
  ON devices (brand_normalised, model_normalised, COALESCE(model_number_normalised, ''), COALESCE(variant_normalised, ''));
CREATE INDEX IF NOT EXISTS devices_brand_series_idx ON devices (brand_id, series_id, status, display_order);
CREATE INDEX IF NOT EXISTS devices_model_number_idx ON devices (model_number_normalised);
CREATE INDEX IF NOT EXISTS devices_model_trgm_idx ON devices USING gin (model_normalised gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Battery profile: one per sellable product. No variants exist in this
-- codebase, so the product row IS the SKU (one identity, one price, one stock).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS battery_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  canonical_code varchar(80) NOT NULL,
  canonical_code_normalised varchar(80) NOT NULL,
  -- CONFIRMED: read from the physical pack. PROVISIONAL: from a list or poster.
  -- DEVICE_NAMED: the stock line is a phone name, not a battery code. MISSING.
  code_status text NOT NULL DEFAULT 'PROVISIONAL',
  supplier_code varchar(120),
  barcode varchar(64),
  battery_category text NOT NULL DEFAULT 'PHONE',
  chemistry text,
  nominal_voltage_mv integer,
  capacity_mah integer,
  watt_hours numeric(7,2),
  length_mm numeric(6,2),
  width_mm numeric(6,2),
  thickness_mm numeric(6,2),
  weight_g numeric(7,2),
  connector_notes varchar(300),
  warranty_months integer,
  supplier_name varchar(160),
  supplier_reference varchar(160),
  packaging_notes text,
  safety_notes text,
  internal_notes text,
  public_notes text,
  lifecycle_status text NOT NULL DEFAULT 'DRAFT',
  verification_status text NOT NULL DEFAULT 'UNVERIFIED',
  verified_by uuid,
  verified_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  archived_at timestamptz,
  source_import_session_id uuid,
  source_reference varchar(200),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battery_profiles_code_status_chk CHECK (code_status IN ('CONFIRMED','PROVISIONAL','DEVICE_NAMED','MISSING')),
  CONSTRAINT battery_profiles_category_chk CHECK (battery_category IN ('PHONE','MIFI_ROUTER','OTHER')),
  CONSTRAINT battery_profiles_chemistry_chk CHECK (chemistry IS NULL OR chemistry IN ('LI_ION','LI_POLYMER','NIMH','OTHER')),
  CONSTRAINT battery_profiles_lifecycle_chk CHECK (lifecycle_status IN ('DRAFT','REVIEW','READY','ACTIVE','ARCHIVED')),
  CONSTRAINT battery_profiles_verification_chk CHECK (verification_status IN ('UNVERIFIED','VERIFIED')),
  CONSTRAINT battery_profiles_verified_evidence_chk CHECK (verification_status <> 'VERIFIED' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT battery_profiles_active_published_chk CHECK (lifecycle_status <> 'ACTIVE' OR (published_by IS NOT NULL AND published_at IS NOT NULL)),
  CONSTRAINT battery_profiles_specs_positive_chk CHECK (
    (capacity_mah IS NULL OR capacity_mah > 0)
    AND (nominal_voltage_mv IS NULL OR nominal_voltage_mv > 0)
    AND (watt_hours IS NULL OR watt_hours > 0)
    AND (warranty_months IS NULL OR warranty_months >= 0)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS battery_profiles_product_idx ON battery_profiles (product_id);
CREATE UNIQUE INDEX IF NOT EXISTS battery_profiles_code_idx ON battery_profiles (canonical_code_normalised) WHERE lifecycle_status <> 'ARCHIVED';
CREATE UNIQUE INDEX IF NOT EXISTS battery_profiles_barcode_idx ON battery_profiles (barcode) WHERE barcode IS NOT NULL AND lifecycle_status <> 'ARCHIVED';
CREATE INDEX IF NOT EXISTS battery_profiles_lifecycle_idx ON battery_profiles (lifecycle_status, battery_category);
CREATE INDEX IF NOT EXISTS battery_profiles_code_trgm_idx ON battery_profiles USING gin (canonical_code_normalised gin_trgm_ops);

-- Alternative codes. One normalised alias may resolve to at most ONE active
-- battery; the partial unique index is the guarantee, not the UI.
CREATE TABLE IF NOT EXISTS battery_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battery_product_id uuid NOT NULL REFERENCES products(id),
  alias varchar(120) NOT NULL,
  alias_normalised varchar(120) NOT NULL,
  alias_type text NOT NULL DEFAULT 'SEARCH',
  source varchar(200),
  verification_status text NOT NULL DEFAULT 'UNVERIFIED',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battery_aliases_type_chk CHECK (alias_type IN ('CANONICAL','SUPPLIER','BARCODE','CUSTOMER','LEGACY','SEARCH','DEVICE_NAME')),
  CONSTRAINT battery_aliases_verification_chk CHECK (verification_status IN ('UNVERIFIED','VERIFIED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS battery_aliases_active_idx ON battery_aliases (alias_normalised) WHERE is_active;
CREATE INDEX IF NOT EXISTS battery_aliases_product_idx ON battery_aliases (battery_product_id);
CREATE INDEX IF NOT EXISTS battery_aliases_trgm_idx ON battery_aliases USING gin (alias_normalised gin_trgm_ops);

-- Evidence photographs and documents for a battery or a compatibility claim,
-- stored in the media library and referenced here.
CREATE TABLE IF NOT EXISTS battery_evidence_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES media_assets(id),
  kind text NOT NULL DEFAULT 'OTHER',
  note varchar(300),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battery_evidence_subject_chk CHECK (subject_type IN ('BATTERY','COMPATIBILITY')),
  CONSTRAINT battery_evidence_kind_chk CHECK (kind IN ('FRONT','BACK','LABEL','CONNECTOR','PACKAGING','BARCODE','FIT_TEST','DOCUMENT','OTHER'))
);
CREATE INDEX IF NOT EXISTS battery_evidence_subject_idx ON battery_evidence_assets (subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- Compatibility workflow on the existing M:N. `fit_type`, `confidence`,
-- `verified_by`, `verified_at`, `evidence_source` and `notes` (0070) stay and
-- are kept coherent by the use cases: confidence is 'verified' only for a
-- reviewed claim with package or fit evidence, and the 0070 CHECK still holds.
-- ---------------------------------------------------------------------------
ALTER TABLE product_device_compatibility
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS evidence_status text NOT NULL DEFAULT 'SUPPLIER_LISTED',
  ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS evidence_type varchar(60),
  ADD COLUMN IF NOT EXISTS evidence_asset_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS public_condition varchar(300),
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note varchar(500),
  ADD COLUMN IF NOT EXISTS published_by uuid,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_import_session_id uuid,
  ADD COLUMN IF NOT EXISTS source_reference varchar(200),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS product_device_compat_id_idx ON product_device_compatibility (id);
CREATE INDEX IF NOT EXISTS product_device_compat_workflow_idx ON product_device_compatibility (workflow_status, evidence_status);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_device_compat_evidence_status_chk') THEN
    ALTER TABLE product_device_compatibility ADD CONSTRAINT product_device_compat_evidence_status_chk
      CHECK (evidence_status IN ('SUPPLIER_LISTED','PACKAGE_VERIFIED','FIT_TESTED','VERIFIED_EXACT','CONDITIONAL','REJECTED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_device_compat_workflow_chk') THEN
    ALTER TABLE product_device_compatibility ADD CONSTRAINT product_device_compat_workflow_chk
      CHECK (workflow_status IN ('DRAFT','REVIEW','READY','ACTIVE','ARCHIVED'));
  END IF;
  -- A conditional fit must say its condition; a rejected claim can never be live.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_device_compat_conditional_chk') THEN
    ALTER TABLE product_device_compatibility ADD CONSTRAINT product_device_compat_conditional_chk
      CHECK (evidence_status <> 'CONDITIONAL' OR (public_condition IS NOT NULL AND length(public_condition) > 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_device_compat_active_chk') THEN
    ALTER TABLE product_device_compatibility ADD CONSTRAINT product_device_compat_active_chk
      CHECK (workflow_status <> 'ACTIVE' OR (evidence_status <> 'REJECTED' AND published_by IS NOT NULL AND published_at IS NOT NULL));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Finder demand: one row per event, no visitor identity. `session_hash` is a
-- salted hash of the basket credential so search -> product -> cart can be
-- counted without knowing who searched.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS battery_finder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  mode text NOT NULL,
  query_normalised varchar(120),
  outcome text NOT NULL DEFAULT 'NONE',
  brand_id uuid REFERENCES device_brands(id) ON DELETE SET NULL,
  series_id uuid REFERENCES device_series(id) ON DELETE SET NULL,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  battery_product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  result_count integer NOT NULL DEFAULT 0,
  alias_hit boolean NOT NULL DEFAULT false,
  session_hash varchar(64),
  CONSTRAINT battery_finder_events_type_chk CHECK (event_type IN ('SEARCH','DEVICE_SELECTED','RESULT_VIEWED','PRODUCT_VIEWED','ADDED_TO_CART','REQUEST_SUBMITTED')),
  CONSTRAINT battery_finder_events_mode_chk CHECK (mode IN ('FIND_BY_PHONE','SEARCH_CODE','PRODUCT_PAGE','CART')),
  CONSTRAINT battery_finder_events_outcome_chk CHECK (outcome IN ('NONE','RESOLVED','NO_RESULT','AMBIGUOUS','VERIFIED_IN_STOCK','VERIFIED_OUT_OF_STOCK','CONDITIONAL','AWAITING_VERIFICATION'))
);
CREATE INDEX IF NOT EXISTS battery_finder_events_occurred_idx ON battery_finder_events (occurred_at);
CREATE INDEX IF NOT EXISTS battery_finder_events_query_idx ON battery_finder_events (query_normalised, outcome);
CREATE INDEX IF NOT EXISTS battery_finder_events_device_idx ON battery_finder_events (device_id, event_type);

-- A customer asked for a battery the finder could not answer. Contact details
-- are optional and given by the customer; they are kept on the request only.
CREATE TABLE IF NOT EXISTS battery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'FINDER_NO_RESULT',
  query_text varchar(200),
  query_normalised varchar(120),
  brand_text varchar(80),
  device_text varchar(120),
  model_number_text varchar(80),
  battery_code_text varchar(120),
  contact_name varchar(120),
  contact_phone varchar(32),
  notes varchar(1000),
  status text NOT NULL DEFAULT 'OPEN',
  resolution_note varchar(500),
  resolved_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  resolved_alias_id uuid REFERENCES battery_aliases(id) ON DELETE SET NULL,
  resolved_battery_product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  resolved_by uuid,
  resolved_at timestamptz,
  session_hash varchar(64),
  CONSTRAINT battery_requests_source_chk CHECK (source IN ('FINDER_NO_RESULT','PRODUCT_PAGE','ADMIN')),
  CONSTRAINT battery_requests_status_chk CHECK (status IN ('OPEN','MAPPED_DEVICE','ALIAS_ADDED','BATTERY_MAPPED','DRAFT_CREATED','INVALID','RESOLVED'))
);
CREATE INDEX IF NOT EXISTS battery_requests_status_idx ON battery_requests (status, created_at);
CREATE INDEX IF NOT EXISTS battery_requests_query_idx ON battery_requests (query_normalised);

-- ---------------------------------------------------------------------------
-- Inventory ledger. `products.stock_quantity` stays the balance the shop and
-- the checkout read; every change to it now leaves a movement written in the
-- same transaction. Unit cost is supplier cost: never in a public API.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(20) NOT NULL,
  name varchar(80) NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_locations_status_chk CHECK (status IN ('ACTIVE','ARCHIVED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_locations_code_idx ON stock_locations (code);
CREATE UNIQUE INDEX IF NOT EXISTS stock_locations_default_idx ON stock_locations (is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS stock_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name varchar(160) NOT NULL,
  supplier_reference varchar(120),
  location_id uuid REFERENCES stock_locations(id),
  status text NOT NULL DEFAULT 'DRAFT',
  notes varchar(1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid,
  applied_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_receipts_status_chk CHECK (status IN ('DRAFT','APPLIED','CANCELLED'))
);
CREATE INDEX IF NOT EXISTS stock_receipts_status_idx ON stock_receipts (status, created_at);

CREATE TABLE IF NOT EXISTS stock_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES stock_receipts(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  scanned_code varchar(120),
  match_kind text NOT NULL DEFAULT 'EXISTING',
  quantity integer NOT NULL,
  unit_cost_ugx integer,
  notes varchar(300),
  movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_receipt_lines_match_chk CHECK (match_kind IN ('EXISTING','NEW','AMBIGUOUS')),
  CONSTRAINT stock_receipt_lines_qty_chk CHECK (quantity > 0),
  CONSTRAINT stock_receipt_lines_cost_chk CHECK (unit_cost_ugx IS NULL OR unit_cost_ugx >= 0)
);
CREATE INDEX IF NOT EXISTS stock_receipt_lines_receipt_idx ON stock_receipt_lines (receipt_id);

CREATE TABLE IF NOT EXISTS stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_type text NOT NULL DEFAULT 'CYCLE',
  location_id uuid REFERENCES stock_locations(id),
  status text NOT NULL DEFAULT 'DRAFT',
  notes varchar(1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_by uuid,
  applied_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_counts_type_chk CHECK (count_type IN ('CYCLE','FULL')),
  CONSTRAINT stock_counts_status_chk CHECK (status IN ('DRAFT','APPLIED','CANCELLED'))
);
CREATE INDEX IF NOT EXISTS stock_counts_status_idx ON stock_counts (status, created_at);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  system_quantity integer NOT NULL,
  counted_quantity integer NOT NULL,
  reason varchar(300),
  movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_count_lines_qty_chk CHECK (counted_quantity >= 0 AND system_quantity >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS stock_count_lines_product_idx ON stock_count_lines (count_id, product_id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  location_id uuid REFERENCES stock_locations(id),
  movement_type text NOT NULL,
  quantity_delta integer NOT NULL,
  quantity_before integer NOT NULL,
  quantity_after integer NOT NULL,
  reason varchar(500) NOT NULL,
  supplier_name varchar(160),
  reference_number varchar(120),
  unit_cost_ugx integer,
  receipt_id uuid REFERENCES stock_receipts(id) ON DELETE SET NULL,
  count_id uuid REFERENCES stock_counts(id) ON DELETE SET NULL,
  import_session_id uuid,
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movements_type_chk CHECK (movement_type IN ('OPENING','RECEIPT','COUNT','ADJUSTMENT','DAMAGED','LOST','RETURN','CORRECTION')),
  CONSTRAINT inventory_movements_balance_chk CHECK (quantity_after = quantity_before + quantity_delta AND quantity_after >= 0),
  CONSTRAINT inventory_movements_cost_chk CHECK (unit_cost_ugx IS NULL OR unit_cost_ugx >= 0)
);
CREATE INDEX IF NOT EXISTS inventory_movements_product_idx ON inventory_movements (product_id, occurred_at);
CREATE INDEX IF NOT EXISTS inventory_movements_occurred_idx ON inventory_movements (occurred_at);
CREATE INDEX IF NOT EXISTS inventory_movements_receipt_idx ON inventory_movements (receipt_id);

-- ---------------------------------------------------------------------------
-- Staged spreadsheet imports. Same lifecycle as pim_import_* (immutable source
-- rows, explicit mapping, deterministic preview, four-eyes approval, transactional
-- apply, rollback, downloadable error report), with real file upload, mapping
-- templates, per-type validation, held rows and applied record ids.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS battery_import_mapping_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type text NOT NULL,
  name varchar(120) NOT NULL,
  mapping jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battery_import_templates_type_chk CHECK (import_type IN ('BATTERY_CATALOGUE','COMPATIBILITY','STOCK_RECEIPT','STOCK_COUNT','PRICE_UPDATE'))
);
CREATE UNIQUE INDEX IF NOT EXISTS battery_import_templates_name_idx ON battery_import_mapping_templates (import_type, name);

CREATE TABLE IF NOT EXISTS battery_import_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_type text NOT NULL,
  name varchar(160) NOT NULL,
  source_filename varchar(255) NOT NULL,
  source_sha256 varchar(64) NOT NULL,
  source_sheet varchar(120),
  source_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'UPLOADED',
  version integer NOT NULL DEFAULT 1,
  mapping jsonb,
  mapping_template_id uuid REFERENCES battery_import_mapping_templates(id) ON DELETE SET NULL,
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  held_rows integer NOT NULL DEFAULT 0,
  excluded_rows integer NOT NULL DEFAULT 0,
  applied_rows integer NOT NULL DEFAULT 0,
  failed_rows integer NOT NULL DEFAULT 0,
  preview_digest varchar(64),
  rollback_info jsonb,
  created_by uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  applied_by uuid,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battery_import_sessions_type_chk CHECK (import_type IN ('BATTERY_CATALOGUE','COMPATIBILITY','STOCK_RECEIPT','STOCK_COUNT','PRICE_UPDATE')),
  CONSTRAINT battery_import_sessions_status_chk CHECK (status IN ('UPLOADED','MAPPED','READY_FOR_APPROVAL','APPROVED','APPLYING','APPLIED','PARTIALLY_APPLIED','FAILED','ROLLED_BACK','ROLLBACK_PARTIAL','REJECTED'))
);
-- The same file may be staged once per import type (the audit workbook is both a
-- catalogue and a compatibility source); the same file for the same type is the
-- same session, never a second one.
CREATE UNIQUE INDEX IF NOT EXISTS battery_import_sessions_source_idx ON battery_import_sessions (import_type, source_sha256);
CREATE INDEX IF NOT EXISTS battery_import_sessions_status_idx ON battery_import_sessions (status, created_at);

CREATE TABLE IF NOT EXISTS battery_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES battery_import_sessions(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  row_key varchar(200),
  source_data jsonb NOT NULL,
  normalized_data jsonb,
  proposed_action varchar(40) NOT NULL DEFAULT 'PENDING',
  validation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'PENDING',
  resolution varchar(40),
  resolution_note varchar(500),
  resolved_by uuid,
  resolved_at timestamptz,
  applied_record_ids jsonb,
  before_snapshot jsonb,
  after_snapshot jsonb,
  applied_at timestamptz,
  error text,
  CONSTRAINT battery_import_rows_status_chk CHECK (status IN ('PENDING','VALID','INVALID','HELD','EXCLUDED','APPLIED','SKIPPED','FAILED','ROLLED_BACK'))
);
CREATE UNIQUE INDEX IF NOT EXISTS battery_import_rows_session_row_idx ON battery_import_rows (session_id, row_number);
CREATE INDEX IF NOT EXISTS battery_import_rows_status_idx ON battery_import_rows (session_id, status);

CREATE TABLE IF NOT EXISTS battery_import_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES battery_import_sessions(id) ON DELETE CASCADE,
  action varchar(40) NOT NULL,
  actor_id uuid NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS battery_import_events_session_idx ON battery_import_events (session_id, created_at);

-- ---------------------------------------------------------------------------
-- Admin-owned finder copy and ordering rules: one JSONB document, singleton row,
-- seeded add-only at boot from DEFAULT_BATTERY_FINDER_CONFIG.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS battery_finder_config (
  id boolean PRIMARY KEY DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT battery_finder_config_singleton CHECK (id = true)
);
