-- U2 §13 — device catalogue + product-device compatibility.
--
-- WHY
-- Ugandan search is device-anchored ("charger for Tecno Spark 20"). The existing
-- product_compatibility_mappings is product-to-product; this adds the missing
-- device dimension so accessories match a phone MODEL. No specification is
-- invented: unsourced fields are null and confidence is 'declared', never
-- 'verified'. Verified rows require an actor, an evidence source and a timestamp.
--
-- LOCK RISK: additive (two new tables + indexes). Safe online.

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand varchar(60) NOT NULL,
  model varchar(120) NOT NULL,
  brand_normalised varchar(60) NOT NULL,
  model_normalised varchar(120) NOT NULL,
  model_aliases text[] NOT NULL DEFAULT '{}',
  model_aliases_normalised text[] NOT NULL DEFAULT '{}',
  slug varchar(160) NOT NULL,
  release_year integer,
  connector_type varchar(16),
  charging_wattage_max integer,
  screen_diagonal_mm integer,
  screen_width_mm integer,
  screen_height_mm integer,
  camera_cutout_type varchar(40),
  popularity_rank_ug integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devices_connector_type_chk CHECK (connector_type IS NULL OR connector_type IN ('usb_c','micro_usb','lightning','other'))
);

CREATE UNIQUE INDEX devices_slug_idx ON devices (slug);
CREATE UNIQUE INDEX devices_brand_model_idx ON devices (brand_normalised, model_normalised);
CREATE INDEX devices_popularity_idx ON devices (popularity_rank_ug);

CREATE TABLE product_device_compatibility (
  product_id uuid NOT NULL REFERENCES products(id),
  device_id uuid NOT NULL REFERENCES devices(id),
  fit_type varchar(20) NOT NULL,
  confidence varchar(12) NOT NULL,
  verified_by uuid,
  verified_at timestamptz,
  evidence_source varchar(300),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, device_id),
  CONSTRAINT product_device_compat_fit_chk CHECK (fit_type IN ('exact','universal','adapter_required')),
  CONSTRAINT product_device_compat_confidence_chk CHECK (confidence IN ('verified','inferred','declared')),
  -- Verified compatibility must carry its evidence (actor + source + time).
  CONSTRAINT product_device_compat_verified_evidence_chk CHECK (
    confidence <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND evidence_source IS NOT NULL)
  )
);

CREATE INDEX product_device_compat_device_idx ON product_device_compatibility (device_id);
