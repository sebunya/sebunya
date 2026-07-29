-- Payments: record whether the webhook that created them was authenticated.
--
-- CONTEXT
-- signatureVerified was computed by the webhook route, threaded through the use
-- case and returned in the result, without ever gating anything. Unsigned,
-- wrongly-signed and unconfigured-secret webhooks were all recorded as genuine
-- payments. That is now refused.
--
-- WHY THIS TABLE CHANGES
-- A monitored grace mode exists for deployments whose provider secrets are not
-- yet configured (PAYMENT_WEBHOOK_UNVERIFIED_GRACE, default off). In that mode
-- an unverified webhook IS recorded — but it must be distinguishable from an
-- authenticated one, permanently and by query, not by grepping application logs
-- that roll over. A payment nobody can prove was authorised is a finance
-- problem, and finance cannot act on a log line.
--
-- Without these columns "flagged for manual review" would be a phrase with no
-- mechanism behind it.
--
-- CHANGE
--   signature_verified   was the creating webhook authenticated?
--   requires_review      does a human still need to confirm this payment?
--   reviewed_at          when a human confirmed it (never set by the application)
--
-- signature_verified defaults to TRUE for existing rows. Those rows predate the
-- distinction, so marking them false would assert something about historical
-- payments that this migration cannot know, and would flood the review queue
-- with every payment ever taken. New rows always get an explicit value.
--
-- Additive and idempotent. No data is read, moved or discarded.
-- Rollback:
--   ALTER TABLE "payments" DROP COLUMN IF EXISTS "signature_verified";
--   ALTER TABLE "payments" DROP COLUMN IF EXISTS "requires_review";
--   ALTER TABLE "payments" DROP COLUMN IF EXISTS "reviewed_at";

ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "signature_verified" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "requires_review" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "payments"
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone;
--> statement-breakpoint
-- A payment awaiting review is an open finance item. Partial, so the index stays
-- small however many payments are taken.
CREATE INDEX IF NOT EXISTS "payments_requires_review_idx"
  ON "payments" ("created_at" DESC)
  WHERE "requires_review" = true;
--> statement-breakpoint
-- A reviewed payment is no longer awaiting review, and an unreviewed one has no
-- review timestamp. Prevents the two flags drifting apart into a state where
-- nobody can tell whether the review happened.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_review_state_consistent') THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_review_state_consistent"
      CHECK (
        ("requires_review" = true AND "reviewed_at" IS NULL)
        OR ("requires_review" = false)
      );
  END IF;
END
$$;
--> statement-breakpoint
-- An authenticated payment is never in the review queue for THIS reason. Stated
-- as a constraint so grace mode cannot be widened later into "record everything
-- unverified and never flag it".
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_unverified_requires_review') THEN
    ALTER TABLE "payments"
      ADD CONSTRAINT "payments_unverified_requires_review"
      CHECK ("signature_verified" = true OR "requires_review" = true OR "reviewed_at" IS NOT NULL);
  END IF;
END
$$;
