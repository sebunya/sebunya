-- Measurement hygiene (0142). Additive: indexes the attribution scan actually
-- uses, and the retention support for collector receipts.
--
-- Rollback: DROP INDEX on the three indexes below. No data is changed.

-- The nightly attribution scan filters on environment + time, not on the visitor.
CREATE INDEX IF NOT EXISTS touchpoint_env_time_idx ON measurement.touchpoint (environment, occurred_at);
--> statement-breakpoint
-- Confirmed sales in the window are the attribution input; without this the
-- scan walks every event ever recorded.
CREATE INDEX IF NOT EXISTS business_event_name_time_idx ON measurement.business_event (environment, event_name, occurred_at);
--> statement-breakpoint
-- A receipt only has to outlive a client's retries; the index makes the prune cheap.
CREATE INDEX IF NOT EXISTS collector_batch_prune_idx ON measurement.collector_batch (received_at) WHERE received_at IS NOT NULL;
--> statement-breakpoint
-- When measurement began, recorded ONCE so the "sales with no record" canary has
-- a fixed floor. Without it the canary compares against the first event ever
-- written, and a writer that never worked at all would read a permanent zero —
-- silent in exactly the case the canary exists to catch. Orders placed before
-- this moment are expected to have no events and are not counted as missing.
-- On this production database there were no orders between 0140 and 0142, so
-- `now()` is the true start; where events already exist, the first one wins.
INSERT INTO measurement.control (key, value, reason)
SELECT 'measurement_started_at',
       to_jsonb(coalesce((SELECT min(recorded_at) FROM measurement.business_event), now())),
       'set by migration 0142'
WHERE NOT EXISTS (SELECT 1 FROM measurement.control WHERE key = 'measurement_started_at');
