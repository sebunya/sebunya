-- A compatibility research row can arrive with NO battery code (the 14 iPhone
-- lines name the phone, not the pack) or with a code the catalogue spells
-- differently. Until now the only repair was "correct the spreadsheet and
-- upload again". This records a person's decision — "this row is about THAT
-- catalogue battery" — beside the row, never inside it: source_data keeps what
-- the research said, word for word.
--
-- It answers identity only. The row still stages DRAFT + SUPPLIER_LISTED and
-- still needs evidence, a second person and an active battery to publish.
-- Rollback: ALTER TABLE battery_import_rows DROP COLUMN linked_battery_code, DROP COLUMN linked_battery_by, DROP COLUMN linked_battery_at;
ALTER TABLE "battery_import_rows" ADD COLUMN IF NOT EXISTS "linked_battery_code" varchar(80);
--> statement-breakpoint
ALTER TABLE "battery_import_rows" ADD COLUMN IF NOT EXISTS "linked_battery_by" uuid;
--> statement-breakpoint
ALTER TABLE "battery_import_rows" ADD COLUMN IF NOT EXISTS "linked_battery_at" timestamptz;
