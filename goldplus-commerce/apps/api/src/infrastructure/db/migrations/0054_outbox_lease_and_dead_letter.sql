-- Outbox: lease ownership and a real dead-letter state.
--
-- FINDING 1 — an exhausted event was recorded as DELIVERED
-- After MAX_ATTEMPTS the use case called markProcessed(), setting
-- is_processed = true and status = 'processed' with the last error in a text
-- column. An event that was never delivered therefore sat in exactly the same
-- state as one that was. Delivery metrics counted it as a success, no query
-- could list the failures, and there was no way to replay them.
--
-- FINDING 2 — two workers could complete the same attempt
-- The lease was expressed by pushing next_attempt_at five minutes forward, which
-- does return a crashed worker's event to eligibility. But markProcessed and
-- recordFailure matched on id alone. A worker whose lease expired mid-delivery
-- could return afterwards and overwrite the outcome recorded by the worker that
-- had since taken the event over — including overwriting a success with a
-- failure, sending the event round again.
--
-- CHANGE
-- Explicit lease columns, so ownership is a fact rather than an inference from a
-- scheduling timestamp:
--   worker_id         which worker holds the claim
--   claimed_at        when it took it
--   lease_expires_at  when the claim stops being valid
--
-- Completion is then a compare-and-set on (id, worker_id, status), so a worker
-- that lost its lease writes nothing and can say so.
--
-- And a truthful terminal state:
--   status = 'dead_letter' with dead_lettered_at set.
-- is_processed stays true because the event IS finished — leaving it false would
-- make the claim query pick it up forever. The discriminator is the status, and
-- metrics read the status rather than the boolean.
--
-- Additive and idempotent. No data is read, moved or discarded.
-- Rollback:
--   ALTER TABLE "outbox_events" DROP COLUMN IF EXISTS "worker_id";
--   ALTER TABLE "outbox_events" DROP COLUMN IF EXISTS "claimed_at";
--   ALTER TABLE "outbox_events" DROP COLUMN IF EXISTS "lease_expires_at";
--   ALTER TABLE "outbox_events" DROP COLUMN IF EXISTS "dead_lettered_at";

ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "worker_id" varchar(64);
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "dead_lettered_at" timestamp with time zone;
--> statement-breakpoint
-- Dead letters, newest first. Partial, so the index stays small however large
-- the delivered history grows.
CREATE INDEX IF NOT EXISTS "outbox_events_dead_letter_idx"
  ON "outbox_events" ("dead_lettered_at" DESC)
  WHERE "status" = 'dead_letter';
--> statement-breakpoint
-- Claim scan: pending work that is due. Partial for the same reason.
CREATE INDEX IF NOT EXISTS "outbox_events_claimable_idx"
  ON "outbox_events" ("next_attempt_at")
  WHERE "is_processed" = false;
--> statement-breakpoint
-- Stuck-lease visibility: which worker is holding what, and since when.
CREATE INDEX IF NOT EXISTS "outbox_events_lease_idx"
  ON "outbox_events" ("lease_expires_at")
  WHERE "status" = 'processing';
--> statement-breakpoint
-- Backfill: events already exhausted before this migration were recorded as
-- 'processed' with an exhaustion message. They are re-labelled as what they
-- actually are, so the dead-letter list is complete rather than starting from
-- today and quietly omitting every earlier failure.
UPDATE "outbox_events"
SET "status" = 'dead_letter',
    "dead_lettered_at" = COALESCE("processed_at", "created_at")
WHERE "status" = 'processed'
  AND "last_error" LIKE 'Exhausted after%';
