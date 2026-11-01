-- 0160 — Repair jsonb values stored as JSON STRINGS.
--
-- `${JSON.stringify(v)}::jsonb` through drizzle + postgres-js binds the text as
-- a jsonb parameter, which the driver JSON-encodes again: the column receives
-- a jsonb STRING ("{\"district\":...}"), not an object. The jsonbStrict /
-- jsonbObject column types (commerce.ts, first-party.ts) did exactly this, so
-- every orders.delivery_location written since jsonbStrict landed is a string
-- and SQL such as `delivery_location->>'district'` (Customer 360, customer
-- facts, delivery config) reads NULL. The writers now cast `::text::jsonb`.
--
-- This converts existing string values whose text is a JSON object or array
-- into that object/array. Values that are not JSON containers are left alone.
-- Readers accept both shapes, so old and new code run correctly either side.
-- Idempotent: a second run finds no strings.
-- A string that starts with { or [ but is not valid JSON is left as it is
-- (pg_input_is_valid, PostgreSQL 16) instead of failing the whole migration.
-- Edited 2026-11 after it had run in production: drizzle's migrator records a
-- hash but only compares created_at, so the edit affects fresh databases only.
--
-- Rollback: none needed (the data means the same thing; only its jsonb type
-- is corrected).
UPDATE orders SET delivery_location = (delivery_location #>> '{}')::jsonb
WHERE jsonb_typeof(delivery_location) = 'string' AND (delivery_location #>> '{}') ~ '^\s*[\{\[]'
  AND pg_input_is_valid(delivery_location #>> '{}', 'jsonb');
--> statement-breakpoint
UPDATE customer_segments SET definition = (definition #>> '{}')::jsonb
WHERE jsonb_typeof(definition) = 'string' AND (definition #>> '{}') ~ '^\s*[\{\[]'
  AND pg_input_is_valid(definition #>> '{}', 'jsonb');
--> statement-breakpoint
UPDATE customer_segment_runs SET stats = (stats #>> '{}')::jsonb
WHERE jsonb_typeof(stats) = 'string' AND (stats #>> '{}') ~ '^\s*[\{\[]'
  AND pg_input_is_valid(stats #>> '{}', 'jsonb');
--> statement-breakpoint
UPDATE analysis.traffic_exclusion_runs SET rules = (rules #>> '{}')::jsonb
WHERE jsonb_typeof(rules) = 'string' AND (rules #>> '{}') ~ '^\s*[\{\[]'
  AND pg_input_is_valid(rules #>> '{}', 'jsonb');
--> statement-breakpoint
UPDATE privacy_requests SET result = (result #>> '{}')::jsonb
WHERE jsonb_typeof(result) = 'string' AND (result #>> '{}') ~ '^\s*[\{\[]'
  AND pg_input_is_valid(result #>> '{}', 'jsonb');
