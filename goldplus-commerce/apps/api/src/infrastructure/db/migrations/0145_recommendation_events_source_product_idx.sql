-- recommendation_events.source_product_id is a foreign key to products with no
-- index. Deleting ONE product makes PostgreSQL scan all ~830k event rows to
-- check it (found 2026-09-20: a test's product cleanup took >10 s on a
-- production-size clone; an admin product delete pays the same). Partial,
-- because almost every row has no source product, so the index stays tiny.
--
-- Plain CREATE INDEX (the migrator runs in a transaction, so CONCURRENTLY is
-- not available): it blocks event INSERTs for the few seconds of one table
-- scan. Event ingestion is fire-and-forget and never blocks a page or checkout.
-- Rollback: DROP INDEX recommendation_events_source_product_idx;
-- Bounded: if the table lock is not granted within 5 s the migration ABORTS
-- (the whole migrate transaction rolls back and can simply be re-run) rather
-- than queueing — a queued SHARE lock would make every later event insert
-- wait behind it. The build itself may not exceed 2 minutes.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recommendation_events_source_product_idx"
  ON "recommendation_events" ("source_product_id")
  WHERE "source_product_id" IS NOT NULL;
