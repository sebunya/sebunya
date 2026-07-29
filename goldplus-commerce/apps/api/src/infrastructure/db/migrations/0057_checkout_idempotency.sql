-- Checkout: a durable, atomically-claimed idempotency record.
--
-- FINDING
-- Checkout idempotency was a read-then-write on the orders table: look up
-- client_order_key, and if nothing came back, create the order. Two concurrent
-- submissions both read nothing and both proceeded to do commerce work — pricing
-- evaluation, capacity reservation, order creation. The unique index on
-- client_order_key caught the second INSERT, but only after the work was done,
-- and only because that index happened to exist.
--
-- The identity was also derived from caller-supplied contact details, so it was
-- not an authorization boundary: anyone could adopt any identity by typing it.
--
-- RISK
-- Duplicate orders, duplicate capacity reservations and duplicate payment
-- handoffs on any double-submission that raced. And no record of the DECISION:
-- nothing said whether a key had been seen, what request it belonged to, or
-- whether the operation had finished, so a retry after a lost response could not
-- be answered safely.
--
-- CHANGE
-- One row per (principal, client order key), claimed with INSERT ... ON CONFLICT
-- so exactly one concurrent request wins and the loser is told to wait rather
-- than duplicating the work.
--
--   identity        sha256(principal || client order key) — the raw key is never
--                   stored, because callers put meaningful data in it
--   principal_key   the trusted, server-issued principal ('u:<id>' or 'g:<id>')
--   fingerprint     canonical hash of the operation actually requested
--   state           IN_PROGRESS | COMPLETED | FAILED_RETRYABLE | FAILED_FINAL
--   order_id        the result, once there is one
--
-- The fingerprint is what makes "same key, materially different order"
-- detectable. Without it, reusing a key for a different basket silently returned
-- the earlier order — the customer shown, and charged for, something they did
-- not ask for.
--
-- Additive and idempotent. No existing data is read, moved or discarded, and the
-- orders table is untouched.
-- Rollback: DROP TABLE IF EXISTS "checkout_idempotency";

CREATE TABLE IF NOT EXISTS "checkout_idempotency" (
  "identity" varchar(64) PRIMARY KEY,
  "principal_key" varchar(96) NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "state" varchar(20) NOT NULL DEFAULT 'IN_PROGRESS',
  "order_id" uuid,
  "failure_reason" varchar(200),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "checkout_idempotency_state_known" CHECK (
    "state" IN ('IN_PROGRESS', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL')
  ),
  -- A COMPLETED record without an order is incoherent: the replay path would
  -- have nothing to return and would have to invent an answer.
  CONSTRAINT "checkout_idempotency_completed_has_order" CHECK (
    "state" <> 'COMPLETED' OR "order_id" IS NOT NULL
  ),
  -- A terminal failure must say why, or the operator has a dead key and no
  -- explanation for the customer.
  CONSTRAINT "checkout_idempotency_final_has_reason" CHECK (
    "state" <> 'FAILED_FINAL' OR "failure_reason" IS NOT NULL
  )
);
--> statement-breakpoint
-- One order may be reached by at most one idempotency identity. Two identities
-- pointing at one order would mean the same order answered two different
-- requests, which is the duplicate-submission bug wearing a different shape.
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_idempotency_order_idx"
  ON "checkout_idempotency" ("order_id")
  WHERE "order_id" IS NOT NULL;
--> statement-breakpoint
-- Stuck claims: IN_PROGRESS rows whose lease has lapsed, for the operator view
-- and for cleanup. Partial, so it stays small.
CREATE INDEX IF NOT EXISTS "checkout_idempotency_in_progress_idx"
  ON "checkout_idempotency" ("updated_at")
  WHERE "state" = 'IN_PROGRESS';
--> statement-breakpoint
-- Expiry sweep.
CREATE INDEX IF NOT EXISTS "checkout_idempotency_expires_idx"
  ON "checkout_idempotency" ("expires_at");
--> statement-breakpoint
-- Per-principal history, for support answering "what did this customer submit".
CREATE INDEX IF NOT EXISTS "checkout_idempotency_principal_idx"
  ON "checkout_idempotency" ("principal_key", "created_at" DESC);
