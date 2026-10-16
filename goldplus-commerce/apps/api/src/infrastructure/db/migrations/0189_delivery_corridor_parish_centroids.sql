-- 0189: parish centroids on the metro corridor set, and the accuracy of every quote (address system spec, Phase A).
--
-- delivery_corridor has carried centroid_lat / centroid_lng / centroid_source since 0092 and nothing ever wrote
-- them, so every distance is a band midpoint. The parish import (scripts/geo-import-parish-centroids.ts) fills them
-- from the UBOS 2016 parish boundaries and records, per area, where the point came from and how far it can be wrong.
-- delivery_quote_capture gains the three facts a later reader needs to judge a quote: the accuracy tier the
-- customer's location reached, the one-way km to the area's point, and that point's expected error.
-- ug_area gains area_kind, because the 2019 postcode list names prisons, barracks, a university and national parks
-- as parishes, and a door delivery to a national park is not a thing.
--
-- Additive. No fee changes: the model reads measured km only when distance_source = 'measured', which ships off.
-- Rollback: ALTER TABLE ... DROP COLUMN for each column below; older code never reads them.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE delivery_corridor
  ADD COLUMN IF NOT EXISTS centroid_expected_error_m integer,
  ADD COLUMN IF NOT EXISTS centroid_source_ref varchar(160),
  ADD COLUMN IF NOT EXISTS centroid_shared_polygon boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS centroid_updated_at timestamptz;
--> statement-breakpoint
ALTER TABLE delivery_quote_capture
  ADD COLUMN IF NOT EXISTS accuracy_tier varchar(16),
  ADD COLUMN IF NOT EXISTS centroid_km numeric(8,2),
  ADD COLUMN IF NOT EXISTS centroid_expected_error_m integer,
  ADD COLUMN IF NOT EXISTS distance_source varchar(16);
--> statement-breakpoint
-- The location-accuracy report and the calibration window read by created_at; nothing indexed it.
CREATE INDEX IF NOT EXISTS delivery_quote_capture_created_idx ON delivery_quote_capture (created_at);
--> statement-breakpoint
ALTER TABLE ug_area
  ADD COLUMN IF NOT EXISTS area_kind varchar(20) NOT NULL DEFAULT 'neighbourhood',
  -- 'pattern' = derived from the name by the importer (re-runs may change it); 'admin' = a person set it (never overwritten).
  ADD COLUMN IF NOT EXISTS area_kind_source varchar(16) NOT NULL DEFAULT 'pattern';
--> statement-breakpoint
-- Every data import records what it read and what it wrote, so a point can be traced to a source and a year.
CREATE TABLE IF NOT EXISTS geo_data_source_run (
  id bigserial PRIMARY KEY,
  source_name varchar(60) NOT NULL,       -- 'ubos-parishes-2016', 'ict-postcodes-2019', ...
  vintage date,                           -- what the data describes, not when we took it
  file_name varchar(200),
  md5 char(32),
  rows_read integer,
  rows_matched integer,
  rows_written integer,
  params jsonb,
  mode varchar(12) NOT NULL,              -- 'dry_run' | 'applied' | 'refused'
  started_by varchar(120),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  note text
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ug_area_area_kind_check' AND conrelid = 'ug_area'::regclass) THEN
    ALTER TABLE ug_area ADD CONSTRAINT ug_area_area_kind_check
      CHECK (area_kind IN ('neighbourhood','ward','trading_centre','institution','barracks','reserve','water','island','unknown'));
  END IF;
END $$;
