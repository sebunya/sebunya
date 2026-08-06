-- ═══════════════════════════════════════════════════════════════════════════
-- 0096 — Calibration proposals and the first-observation marker
--
-- PROPOSED, NEVER APPLIED. The nightly job writes rows HERE, not into
-- delivery_learned_factor. A factor only ever changes through an accepted
-- proposal with a named actor.
--
-- ADDITIVE AND REVERSIBLE. ZERO INSERTS — the first row appears when the first
-- real observation has been fitted, and none exists.
--
-- Rollback:
--   DROP TABLE delivery_calibration_proposal;
--   DROP TABLE delivery_calibration_milestone;
--   ALTER TABLE delivery_learned_factor DROP COLUMN set_by;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "delivery_calibration_proposal" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "factor_kind" varchar(24) NOT NULL,
  "scope_key" varchar(160) NOT NULL,
  /** NULL when nothing was learned before — never 1.0 standing in for absence. */
  "current_value" numeric(10,4),
  "current_state" varchar(16) NOT NULL,
  "proposed_value" numeric(10,4) NOT NULL,
  "sample_size" integer NOT NULL,
  /** NULL when there is no configured fee for a change to move. */
  "fee_impact_ugx" bigint,
  "status" varchar(12) DEFAULT 'pending' NOT NULL,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "delivery_calibration_proposal_kind_check"
    CHECK ("factor_kind" in ('corridor_factor','hour_factor','detour_factor','last_mile_minutes')),
  CONSTRAINT "delivery_calibration_proposal_status_check"
    CHECK ("status" in ('pending','accepted','rejected','edited')),
  CONSTRAINT "delivery_calibration_proposal_state_check"
    CHECK ("current_state" in ('not_learned','fitted','set_by_hand')),
  -- A proposal resting on nothing is not a proposal. The job already refuses
  -- to emit one; this makes it unstorable as well.
  CONSTRAINT "delivery_calibration_proposal_sample_check" CHECK ("sample_size" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_calibration_proposal_status_idx"
  ON "delivery_calibration_proposal" ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_calibration_proposal_pending_uq"
  ON "delivery_calibration_proposal" ("factor_kind", "scope_key") WHERE "status" = 'pending';
--> statement-breakpoint

-- One-time milestones. The first-observation alert fires ONCE, ever, and this
-- is what makes "once" true across restarts and across replicas.
CREATE TABLE IF NOT EXISTS "delivery_calibration_milestone" (
  "milestone" varchar(48) PRIMARY KEY NOT NULL,
  "order_id" uuid,
  "fired_at" timestamp with time zone DEFAULT now() NOT NULL,
  "note" text
);
--> statement-breakpoint

-- Who set a factor by hand. A human value carries a human's authority and must
-- never be laundered as a fit.
ALTER TABLE "delivery_learned_factor"
  ADD COLUMN IF NOT EXISTS "set_by" uuid;
