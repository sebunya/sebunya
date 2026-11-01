-- Catalogue intelligence (0119): battery compatibility registry + finder
-- telemetry, storage-capacity test records, product lifecycle SEO decisions.
--
-- WHY
-- Battery compatibility is a fact that must be EVIDENCED, never guessed: a row
-- only reaches VERIFIED with an evidence source (enforced here AND in the use
-- case). Storage tests record what was actually measured — a product with no
-- row is honestly NOT_TESTED (there is never a default row). Lifecycle
-- decisions record disposition + rationale + the evidence snapshot they were
-- decided on; redirect dispositions require a successor.
--
-- LOCK RISK: additive only (4 new tables + indexes; FKs reference products
-- only). Safe online.

CREATE TABLE seo_battery_compat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_brand text NOT NULL,
  phone_model text NOT NULL,
  model_number text,
  variant text,
  battery_product_id uuid REFERENCES products(id),
  battery_reference text NOT NULL,
  status text NOT NULL DEFAULT 'UNVERIFIED',
  evidence_source text,
  evidence_note text,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_battery_compat_status_chk CHECK (status IN ('VERIFIED','PROVISIONAL','UNVERIFIED','REJECTED')),
  CONSTRAINT seo_battery_compat_evidence_source_chk CHECK (evidence_source IS NULL OR evidence_source IN ('MANUFACTURER_SHEET','SUPPLIER_SHEET','PHYSICAL_QA','CATALOGUE_EVIDENCE')),
  -- VERIFIED without evidence is impossible at the data layer too.
  CONSTRAINT seo_battery_compat_verified_evidence_chk CHECK (status <> 'VERIFIED' OR evidence_source IS NOT NULL)
);
CREATE UNIQUE INDEX seo_battery_compat_combo_idx
  ON seo_battery_compat (phone_brand, phone_model, COALESCE(variant, ''), battery_reference);
CREATE INDEX seo_battery_compat_status_idx ON seo_battery_compat (status);
CREATE INDEX seo_battery_compat_product_idx ON seo_battery_compat (battery_product_id);

CREATE TABLE seo_battery_finder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  query text NOT NULL,
  phone_brand text,
  phone_model text,
  matched boolean NOT NULL,
  match_count integer NOT NULL DEFAULT 0,
  clicked_product_id uuid
);
CREATE INDEX seo_battery_finder_events_occurred_idx ON seo_battery_finder_events (occurred_at);
CREATE INDEX seo_battery_finder_events_matched_idx ON seo_battery_finder_events (matched, occurred_at);

CREATE TABLE seo_storage_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  claimed_capacity_gb numeric NOT NULL,
  tested_capacity_gb numeric,
  read_mb_s numeric,
  write_mb_s numeric,
  method text NOT NULL,
  tool text,
  tester text NOT NULL,
  tested_at date NOT NULL,
  result text NOT NULL,
  evidence_note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_storage_tests_result_chk CHECK (result IN ('PASS','FAIL','INCONCLUSIVE'))
);
CREATE INDEX seo_storage_tests_product_idx ON seo_storage_tests (product_id, tested_at);

CREATE TABLE seo_product_lifecycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  state text NOT NULL,
  successor_product_id uuid REFERENCES products(id),
  disposition text NOT NULL DEFAULT 'UNDECIDED',
  decided_by uuid,
  decided_at timestamptz,
  rationale text,
  evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_product_lifecycle_state_chk CHECK (state IN ('ACTIVE','TEMPORARILY_OUT_OF_STOCK','DISCONTINUED_WITH_SUCCESSOR','DISCONTINUED_NO_SUCCESSOR','SEASONAL','DRAFT','UNPUBLISHED')),
  CONSTRAINT seo_product_lifecycle_disposition_chk CHECK (disposition IN ('RETAIN_200','OFFER_ALTERNATIVE','REDIRECT_301_SUCCESSOR','REDIRECT_301_REPLACEMENT','GONE_410','UNPUBLISH','UNDECIDED')),
  -- A redirect disposition without a destination is not a decision.
  CONSTRAINT seo_product_lifecycle_redirect_chk CHECK (disposition NOT IN ('REDIRECT_301_SUCCESSOR','REDIRECT_301_REPLACEMENT') OR successor_product_id IS NOT NULL)
);
CREATE UNIQUE INDEX seo_product_lifecycle_product_idx ON seo_product_lifecycle (product_id);
CREATE INDEX seo_product_lifecycle_disposition_idx ON seo_product_lifecycle (disposition);
