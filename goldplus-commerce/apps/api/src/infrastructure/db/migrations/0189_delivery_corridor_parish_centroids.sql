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
  ADD COLUMN IF NOT EXISTS centroid_expected_error_m integer;
--> statement-breakpoint
ALTER TABLE ug_area ADD COLUMN IF NOT EXISTS area_kind varchar(20) NOT NULL DEFAULT 'neighbourhood';
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ug_area_area_kind_check') THEN
    ALTER TABLE ug_area ADD CONSTRAINT ug_area_area_kind_check
      CHECK (area_kind IN ('neighbourhood','ward','trading_centre','institution','barracks','reserve','water','island','unknown'));
  END IF;
END $$;
