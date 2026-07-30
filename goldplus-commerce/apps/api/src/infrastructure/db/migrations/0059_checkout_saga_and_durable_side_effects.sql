-- Checkout: separate operation state from saga stage, and make side effects durable.
--
-- FINDING 1 — an unpaid order was recorded as COMPLETED
-- The use case returned CHECKOUT_COMPLETED for an order that had reached
-- AWAITING_PAYMENT, and set the idempotency record's state to COMPLETED at the
-- same point. Those are different facts. "The checkout operation finished
-- running" is not "the customer has paid and the order is confirmed", and
-- collapsing them means every unpaid order looks finished to anything reading
-- state — reconciliation, support, and the retention sweep below.
--
-- FINDING 2 — side effects were not durable
-- Fulfilment and notification work ran inside the request, and a failure was
-- reported to an observer while the checkout carried on. Reporting is evidence,
-- not durability: if the process died after the order committed, the work was
-- simply gone, and the operator had an order with no task and no record that a
-- task was ever owed.
--
-- CHANGE
-- The two axes are stored separately:
--
--   operation_state  IN_PROGRESS | FAILED_RETRYABLE | FAILED_FINAL | TERMINAL
--                    — did the workflow finish running?
--   stage            where in the saga it actually got to
--
-- `state` is retained unchanged so nothing depending on it breaks; it now means
-- only "is this claim still owned", and operation_state carries the outcome.
--
-- Side-effect events get a durable identity table so "was this already queued?"
-- is answerable after a crash rather than inferred.
--
-- Additive and idempotent. Existing rows are backfilled from their current state.
-- Rollback:
--   ALTER TABLE "checkout_idempotency" DROP COLUMN IF EXISTS "operation_state";
--   DROP TABLE IF EXISTS "checkout_side_effects";

ALTER TABLE "checkout_idempotency"
  ADD COLUMN IF NOT EXISTS "operation_state" varchar(20) NOT NULL DEFAULT 'IN_PROGRESS';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_idempotency_operation_state_known') THEN
    ALTER TABLE "checkout_idempotency"
      ADD CONSTRAINT "checkout_idempotency_operation_state_known" CHECK (
        "operation_state" IN ('IN_PROGRESS', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'TERMINAL')
      );
  END IF;
END
$$;
--> statement-breakpoint
-- Widen the stage vocabulary to the full saga. The previous CHECK stopped at
-- AWAITING_PAYMENT, so the payment stages could not be recorded at all.
ALTER TABLE "checkout_idempotency"
  DROP CONSTRAINT IF EXISTS "checkout_idempotency_stage_known";
--> statement-breakpoint
ALTER TABLE "checkout_idempotency"
  ADD CONSTRAINT "checkout_idempotency_stage_known" CHECK (
    "stage" IN (
      'CLAIMED', 'PRICED', 'ORDER_CREATED', 'INVENTORY_RESERVED', 'BLOCKED_STOCK',
      'FULFILMENT_QUEUED', 'NOTIFICATION_QUEUED', 'PAYMENT_READY', 'PAYMENT_STARTED',
      'PAYMENT_PENDING', 'PAYMENT_REVIEW', 'ORDER_CONFIRMED', 'COMPLETED',
      -- retained so pre-0059 rows remain valid
      'AWAITING_PAYMENT', 'FAILED_RETRYABLE', 'FAILED_FINAL'
    )
  );
--> statement-breakpoint
-- Backfill: an operation whose record said COMPLETED had finished RUNNING, which
-- is TERMINAL. It is deliberately NOT called paid — that is what the stage says.
UPDATE "checkout_idempotency"
SET "operation_state" = CASE
      WHEN "state" = 'COMPLETED' THEN 'TERMINAL'
      WHEN "state" = 'FAILED_FINAL' THEN 'FAILED_FINAL'
      WHEN "state" = 'FAILED_RETRYABLE' THEN 'FAILED_RETRYABLE'
      ELSE 'IN_PROGRESS'
    END
WHERE "operation_state" = 'IN_PROGRESS' AND "state" <> 'IN_PROGRESS';
--> statement-breakpoint
-- Durable side-effect identities.
--
-- One row per (checkout identity, event type). The unique key is what makes
-- "already queued" a fact rather than a guess, so a retry after a crash creates
-- the missing work without duplicating what already exists.
CREATE TABLE IF NOT EXISTS "checkout_side_effects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "checkout_identity" varchar(64) NOT NULL,
  "order_id" uuid NOT NULL,
  "event_type" varchar(64) NOT NULL,
  "policy_version" varchar(48) NOT NULL,
  -- The outbox row this created, so source and delivery can be reconciled.
  "outbox_event_id" uuid,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT now(),
  "trace_id" varchar(128),
  CONSTRAINT "checkout_side_effects_event_known" CHECK (
    "event_type" IN (
      'ORDER_FULFILMENT_REQUIRED',
      'ORDER_ADMIN_NOTIFICATION_REQUIRED',
      'ORDER_CUSTOMER_NOTIFICATION_ELIGIBLE',
      'ORDER_PAYMENT_INITIATION_REQUIRED',
      'ORDER_PAYMENT_VERIFICATION_REQUIRED',
      'ORDER_LOYALTY_ELIGIBILITY_RECORDED',
      'ORDER_MEASUREMENT_ELIGIBILITY_RECORDED'
    )
  )
);
--> statement-breakpoint
-- At most one of each event type per checkout. This is the whole mechanism: a
-- second insert conflicts rather than duplicating the business effect.
CREATE UNIQUE INDEX IF NOT EXISTS "checkout_side_effects_identity_event_idx"
  ON "checkout_side_effects" ("checkout_identity", "event_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checkout_side_effects_order_idx"
  ON "checkout_side_effects" ("order_id");
--> statement-breakpoint
-- Retention support: which checkouts still hold unresolved commerce. A generic
-- expiry sweep must consult this rather than deleting on expires_at alone.
CREATE INDEX IF NOT EXISTS "checkout_idempotency_unresolved_idx"
  ON "checkout_idempotency" ("stage")
  WHERE "stage" IN (
    'ORDER_CREATED', 'INVENTORY_RESERVED', 'BLOCKED_STOCK', 'FULFILMENT_QUEUED',
    'NOTIFICATION_QUEUED', 'PAYMENT_READY', 'PAYMENT_STARTED', 'PAYMENT_PENDING',
    'PAYMENT_REVIEW'
  );
