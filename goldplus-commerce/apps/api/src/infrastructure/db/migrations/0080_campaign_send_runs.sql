-- Send wave (DRY-RUN ONLY) — campaign eligibility decision ledger.
--
-- WHY
-- Before any real send can ever be considered, the gates must exist and be
-- provable: identity -> consent (advertising) -> suppression -> frequency ->
-- quiet hours. A run records one decision per audience subject with the exact
-- excluding gate; the ledger doubles as the frequency-cap memory. The schema has
-- no LIVE vocabulary and rows never carry contact details or message content.
--
-- LOCK RISK: two new tables, additive, safe online.

CREATE TABLE IF NOT EXISTS "campaign_send_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "mode" varchar(12) DEFAULT 'DRY_RUN' NOT NULL,
  "status" varchar(20) DEFAULT 'COMPLETE' NOT NULL,
  "audience_kind" varchar(30) DEFAULT 'ABANDONED_CARTS' NOT NULL,
  "candidates" integer DEFAULT 0 NOT NULL,
  "eligible" integer DEFAULT 0 NOT NULL,
  "excluded_no_identity" integer DEFAULT 0 NOT NULL,
  "excluded_no_consent" integer DEFAULT 0 NOT NULL,
  "excluded_suppressed" integer DEFAULT 0 NOT NULL,
  "excluded_frequency" integer DEFAULT 0 NOT NULL,
  "quiet_hours_at_run" varchar(8) DEFAULT 'NO' NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_send_runs_campaign_idx" ON "campaign_send_runs" ("campaign_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_send_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL REFERENCES "campaign_send_runs"("id") ON DELETE CASCADE,
  "subject_ref" uuid NOT NULL,
  "decision" varchar(24) NOT NULL,
  "detail" varchar(300),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_send_decisions_run_idx" ON "campaign_send_decisions" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_send_decisions_subject_idx" ON "campaign_send_decisions" ("subject_ref");
