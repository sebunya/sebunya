-- ═══════════════════════════════════════════════════════════════════════════
-- 0095 — The variance write path (brief PART 5)
--
-- Every variance writes old fee, new fee, reason, actor, timestamp and
-- agreement. A row here IS that record; the audit log carries the same facts,
-- and the two are written together so a queue and an audit cannot disagree.
--
-- ADDITIVE AND REVERSIBLE. ZERO INSERTS.
--
-- Rollback: DROP TABLE delivery_fee_variance;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "delivery_fee_variance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "old_fee_ugx" bigint NOT NULL,
  "new_fee_ugx" bigint NOT NULL,
  "delta_ugx" bigint NOT NULL,
  /** Closed list, enforced in the domain AND here. */
  "reason" varchar(48) NOT NULL,
  "note" text,
  "disposition" varchar(20) NOT NULL,
  "agreement" varchar(16) NOT NULL,
  "applied_by" uuid NOT NULL,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL,
  "agreement_by" uuid,
  "agreement_at" timestamp with time zone,
  "cancelled_order" boolean DEFAULT false NOT NULL,
  CONSTRAINT "delivery_fee_variance_reason_check" CHECK ("reason" in (
    'ADDRESS_CHANGED_BY_CUSTOMER',
    'AREA_MISMATCH_ON_RESOLUTION',
    'ACCESS_MODE_DIFFERENT',
    'REDELIVERY_AFTER_FAILED_ATTEMPT',
    'MANUAL_ADJUSTMENT_BY_OPS'
  )),
  CONSTRAINT "delivery_fee_variance_disposition_check"
    CHECK ("disposition" in ('absorbed','needs_agreement')),
  CONSTRAINT "delivery_fee_variance_agreement_check"
    CHECK ("agreement" in ('not_required','pending','agreed','declined')),
  -- An absorbed variance never waits on a customer, and one that needs
  -- agreement is never 'not_required'. The pairing is the control, so the
  -- database refuses the combinations that would defeat it.
  CONSTRAINT "delivery_fee_variance_pairing_check" CHECK (
    ("disposition" = 'absorbed' and "agreement" = 'not_required') or
    ("disposition" = 'needs_agreement' and "agreement" in ('pending','agreed','declined'))
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_fee_variance_order_idx"
  ON "delivery_fee_variance" ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "delivery_fee_variance_pending_idx"
  ON "delivery_fee_variance" ("agreement") WHERE "agreement" = 'pending';
