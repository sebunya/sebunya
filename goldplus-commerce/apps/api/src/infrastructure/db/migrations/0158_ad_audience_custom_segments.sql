-- 0158 — Advertising audiences: owner-defined segments (docs/advertising/README.md, "Audiences").
--
-- The audience sync (0154) can now upload the owner's own segments from the
-- first-party module (0155) as Customer Match / Custom Audience lists. Their
-- list slot is `seg:<segment key>` (segment keys are up to 64 characters), so
-- the slot columns are widened from varchar(24) to varchar(80).
--
-- ADDITIVE ONLY: widening a varchar is a catalogue change in PostgreSQL (no
-- table rewrite, no data change); old code writes the same short values.
--
-- Rollback (only while no slot longer than 24 characters exists):
--   ALTER TABLE ad_audience_lists ALTER COLUMN segment TYPE varchar(24);
--   ALTER TABLE ad_audience_runs ALTER COLUMN segment TYPE varchar(24);
ALTER TABLE ad_audience_lists ALTER COLUMN segment TYPE varchar(80);
--> statement-breakpoint
ALTER TABLE ad_audience_runs ALTER COLUMN segment TYPE varchar(80);
