-- Checkout idempotency: fenced lease ownership and durable saga stages.
--
-- FINDING 1 — the lease had no fencing token
-- 0057 allowed a lapsed IN_PROGRESS claim to be taken over, but `complete` and
-- `fail` matched only on (identity, state = 'IN_PROGRESS'). After a takeover the
-- row is IN_PROGRESS again — owned by worker B — so worker A, returning late from
-- a slow pricing call, matched that predicate and could complete or fail an
-- operation it no longer owned. `updated_at` was the only ownership signal, and a
-- timestamp is not proof of identity.
--
-- A fencing token fixes this in the only way that works: every claim and takeover
-- mints a new unguessable token and increments a monotonic fencing number, and
-- every mutation must present both. A stale worker then updates zero rows and can
-- say so, rather than silently overwriting its successor's outcome.
--
-- FINDING 2 — an order could exist with no recoverable link to its checkout
-- The route created and saved the order, then completed the idempotency record in
-- a separate statement. A crash in that window left a committed order and an
-- IN_PROGRESS record with order_id NULL — so a later takeover would re-price,
-- re-reserve and re-create, duplicating the order the customer already had.
--
-- Recording the stage plus the order id under the active fence means a retry can
-- resume from where the work actually got to instead of starting again.
--
-- CHANGE
--   claim_token         unguessable per-claim secret
--   fencing_number      monotonic; a higher number always wins
--   lease_expires_at    explicit, renewable by heartbeat
--   attempt_number      how many workers have owned this operation
--   last_heartbeat_at   proof of liveness, so a working request is not evicted
--   stage               durable saga position
--
-- Additive and idempotent. Existing rows are backfilled with fence 1 and a
-- generated token, so an in-flight 0057-era claim is not silently orphaned.
-- Rollback:
--   ALTER TABLE "checkout_idempotency" DROP COLUMN IF EXISTS "claim_token";
--   ALTER TABLE "checkout_idempotency" DROP COLUMN IF EXISTS "fencing_number";
--   ALTER TABLE "checkout_idempotency" DROP COLUMN IF EXISTS "lease_expires_at";
--   ALTER TABLE "checkout_idempotency" DROP COLUMN IF EXISTS "attempt_number";
--   ALTER TABLE "checkout_idempotency" DROP COLUMN IF EXISTS "last_heartbeat_at";
--   ALTER TABLE "checkout_idempotency" DROP COLUMN IF EXISTS "stage";

ALTER TABLE "checkout_idempotency"
  ADD COLUMN IF NOT EXISTS "claim_token" varchar(64);
--> statement-breakpoint
ALTER TABLE "checkout_idempotency"
  ADD COLUMN IF NOT EXISTS "fencing_number" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "checkout_idempotency"
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "checkout_idempotency"
  ADD COLUMN IF NOT EXISTS "attempt_number" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "checkout_idempotency"
  ADD COLUMN IF NOT EXISTS "last_heartbeat_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "checkout_idempotency"
  ADD COLUMN IF NOT EXISTS "stage" varchar(24) NOT NULL DEFAULT 'CLAIMED';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_idempotency_stage_known') THEN
    ALTER TABLE "checkout_idempotency"
      ADD CONSTRAINT "checkout_idempotency_stage_known" CHECK (
        "stage" IN (
          'CLAIMED', 'PRICED', 'ORDER_CREATED', 'INVENTORY_RESERVED',
          'BLOCKED_STOCK', 'AWAITING_PAYMENT', 'COMPLETED',
          'FAILED_RETRYABLE', 'FAILED_FINAL'
        )
      );
  END IF;
END
$$;
--> statement-breakpoint
-- The fence must only ever move forward. A decreasing fence would let an older
-- worker reclaim ownership, which is the exact failure this exists to prevent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_idempotency_fence_positive') THEN
    ALTER TABLE "checkout_idempotency"
      ADD CONSTRAINT "checkout_idempotency_fence_positive"
      CHECK ("fencing_number" >= 1 AND "attempt_number" >= 1);
  END IF;
END
$$;
--> statement-breakpoint
-- Any stage at or beyond ORDER_CREATED must carry its order. Without this a
-- resume could believe an order exists and have nothing to load.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_idempotency_stage_has_order') THEN
    ALTER TABLE "checkout_idempotency"
      ADD CONSTRAINT "checkout_idempotency_stage_has_order" CHECK (
        "stage" NOT IN ('ORDER_CREATED', 'INVENTORY_RESERVED', 'BLOCKED_STOCK', 'AWAITING_PAYMENT', 'COMPLETED')
        OR "order_id" IS NOT NULL
      );
  END IF;
END
$$;
--> statement-breakpoint
-- Backfill so a 0057-era in-flight claim keeps a usable, ownable identity rather
-- than becoming unmutatable.
UPDATE "checkout_idempotency"
-- gen_random_uuid() is built in; gen_random_bytes() requires pgcrypto, which is
-- not guaranteed to be installed. Using it left this migration part-applied: the
-- ALTERs committed and the backfill aborted.
SET "claim_token" = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    "lease_expires_at" = COALESCE("lease_expires_at", "updated_at" + interval '2 minutes'),
    "last_heartbeat_at" = COALESCE("last_heartbeat_at", "updated_at"),
    "stage" = CASE
      WHEN "state" = 'COMPLETED' THEN 'COMPLETED'
      WHEN "state" = 'FAILED_FINAL' THEN 'FAILED_FINAL'
      WHEN "state" = 'FAILED_RETRYABLE' THEN 'FAILED_RETRYABLE'
      WHEN "order_id" IS NOT NULL THEN 'ORDER_CREATED'
      ELSE 'CLAIMED'
    END
WHERE "claim_token" IS NULL;
--> statement-breakpoint
-- Lease sweep: which claims are eligible for takeover.
CREATE INDEX IF NOT EXISTS "checkout_idempotency_lease_idx"
  ON "checkout_idempotency" ("lease_expires_at")
  WHERE "state" = 'IN_PROGRESS';
--> statement-breakpoint
-- Operator view: operations that got partway and stopped.
CREATE INDEX IF NOT EXISTS "checkout_idempotency_stage_idx"
  ON "checkout_idempotency" ("stage", "updated_at" DESC);
