-- Control Centre: governed module activation approvals.
--
-- The readiness service resolves activationStatus for an OPERATOR_APPROVAL module
-- by asking whether a live approval record exists. Without this table the probe
-- fails closed and every such module is permanently DORMANT — safe, but it means
-- loyalty, automation, pricing, surveys, interventions, experiments and PIM import
-- can never be switched on through a governed path.
--
-- Activation must be a recorded human decision, never a deploy-time flag, so the
-- record carries who approved, why, and the reference that authorised it. Revoking
-- sets revoked_at rather than deleting, so the history of what was live and when
-- survives for audit.
--
-- Additive and idempotent: creates one new table, no backfill, no destructive
-- change. Rollback is DROP TABLE IF EXISTS "module_activation_approvals", which
-- returns every module to DORMANT — the safe direction.

CREATE TABLE IF NOT EXISTS "module_activation_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Matches ControlCentreModule.key in packages/shared/src/control-centre.
  "module_key" varchar(64) NOT NULL,
  "approved_by" uuid NOT NULL,
  "approved_at" timestamp with time zone NOT NULL DEFAULT now(),
  -- Why activation was granted. Required: an approval without a stated reason is
  -- not auditable.
  "reason" text NOT NULL,
  -- Policy, ticket or decision record that authorised this activation.
  "approval_reference" varchar(255) NOT NULL,
  "revoked_by" uuid,
  "revoked_at" timestamp with time zone,
  "revocation_reason" text,
  "trace_id" varchar(128),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "module_activation_approvals_reason_not_blank"
    CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "module_activation_approvals_reference_not_blank"
    CHECK (length(btrim("approval_reference")) > 0),
  -- A revocation must be complete: actor, time and reason together or none.
  CONSTRAINT "module_activation_approvals_revocation_complete" CHECK (
    ("revoked_at" IS NULL AND "revoked_by" IS NULL AND "revocation_reason" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL
        AND length(btrim(COALESCE("revocation_reason", ''))) > 0)
  ),
  CONSTRAINT "module_activation_approvals_revoked_after_approved"
    CHECK ("revoked_at" IS NULL OR "revoked_at" >= "approved_at")
);
--> statement-breakpoint
-- At most one live approval per module, so activation state can never be ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "module_activation_approvals_live_module_idx"
  ON "module_activation_approvals" ("module_key")
  WHERE "revoked_at" IS NULL;
--> statement-breakpoint
-- The readiness probe's exact lookup: module_key with revoked_at IS NULL.
CREATE INDEX IF NOT EXISTS "module_activation_approvals_module_idx"
  ON "module_activation_approvals" ("module_key", "revoked_at");
--> statement-breakpoint
-- ADD CONSTRAINT has no IF NOT EXISTS, so the foreign keys are guarded explicitly.
-- Without this the migration applies once and then fails on any replay, which
-- breaks the idempotent-migration requirement and any rehearsal that re-runs the
-- chain.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'module_activation_approvals_approved_by_fk'
  ) THEN
    ALTER TABLE "module_activation_approvals"
      ADD CONSTRAINT "module_activation_approvals_approved_by_fk"
      FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'module_activation_approvals_revoked_by_fk'
  ) THEN
    ALTER TABLE "module_activation_approvals"
      ADD CONSTRAINT "module_activation_approvals_revoked_by_fk"
      FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE RESTRICT;
  END IF;
END $$;
