-- 0191: how many stops the rider took on the trip this order went out on (address system spec §4.6, §16).
-- The model prices each order as a dedicated round trip; on batched days the real cost per order is lower.
-- Recording the count lets margin be set from evidence instead of padded. Additive; rollback: DROP COLUMN.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE fulfilment_dispatches ADD COLUMN IF NOT EXISTS stops_on_trip smallint CHECK (stops_on_trip IS NULL OR stops_on_trip BETWEEN 1 AND 50);
