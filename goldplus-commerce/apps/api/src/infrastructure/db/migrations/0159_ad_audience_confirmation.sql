-- 0159 — Advertising audiences: platform confirmation, run locks, daily retries
-- (docs/advertising/README.md, "Audiences" and "Schedule").
--
-- 1. ad_audience_runs gains the confirmation of an asynchronous platform
--    upload. Google's Data Manager API accepts audienceMembers:ingest and
--    :removeAll with only a requestId; the outcome (SUCCESS, PARTIAL_SUCCESS,
--    FAILED per destination) is read later from requestStatus:retrieve. A run
--    is logged SUBMITTED with its request ids; the 5-minute tick polls them and
--    fills the confirmation columns. The run's own recorded columns (what was
--    computed and sent) are never rewritten: only the confirmation_* columns,
--    sweep_request_id and next_check_at are updated.
--      remote_requests       {"kind":"REPLACE"|"CLEAR","ingest":[ids],"sweep":id|null}
--      confirmation          WAITING | SWEEPING | CONFIRMED | PARTIAL | FAILED | UNCONFIRMED (NULL = nothing to confirm)
-- 2. ad_job_claims gains leases and attempts: a per-platform run lock (a SYNC
--    never overlaps another SYNC of the same platform) and per-platform daily
--    jobs that are retried on later ticks the same day when they fail.
--    Existing rows (one-shot daily claims) keep their meaning: done_at NULL and
--    lease_until NULL are never re-claimed by the new code (different keys).
--
-- ADDITIVE ONLY: nullable columns and defaults, one partial index.
--
-- Rollback:
--   DROP INDEX IF EXISTS ad_audience_runs_confirmation_idx;
--   ALTER TABLE ad_audience_runs DROP COLUMN IF EXISTS remote_requests, DROP COLUMN IF EXISTS confirmation,
--     DROP COLUMN IF EXISTS confirmation_detail, DROP COLUMN IF EXISTS confirmed_at,
--     DROP COLUMN IF EXISTS confirmation_checks, DROP COLUMN IF EXISTS next_check_at;
--   ALTER TABLE ad_job_claims DROP COLUMN IF EXISTS attempts, DROP COLUMN IF EXISTS done_at,
--     DROP COLUMN IF EXISTS lease_until, DROP COLUMN IF EXISTS holder;
ALTER TABLE ad_audience_runs ADD COLUMN IF NOT EXISTS remote_requests jsonb;
--> statement-breakpoint
ALTER TABLE ad_audience_runs ADD COLUMN IF NOT EXISTS confirmation varchar(16);
--> statement-breakpoint
ALTER TABLE ad_audience_runs ADD COLUMN IF NOT EXISTS confirmation_detail text;
--> statement-breakpoint
ALTER TABLE ad_audience_runs ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
--> statement-breakpoint
ALTER TABLE ad_audience_runs ADD COLUMN IF NOT EXISTS confirmation_checks integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE ad_audience_runs ADD COLUMN IF NOT EXISTS next_check_at timestamptz;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE ad_audience_runs ADD CONSTRAINT ad_audience_runs_confirmation_chk
    CHECK (confirmation IS NULL OR confirmation IN ('WAITING', 'SWEEPING', 'CONFIRMED', 'PARTIAL', 'FAILED', 'UNCONFIRMED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ad_audience_runs_confirmation_idx ON ad_audience_runs (next_check_at)
  WHERE confirmation IN ('WAITING', 'SWEEPING');
--> statement-breakpoint
ALTER TABLE ad_job_claims ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE ad_job_claims ADD COLUMN IF NOT EXISTS done_at timestamptz;
--> statement-breakpoint
ALTER TABLE ad_job_claims ADD COLUMN IF NOT EXISTS lease_until timestamptz;
--> statement-breakpoint
ALTER TABLE ad_job_claims ADD COLUMN IF NOT EXISTS holder varchar(64);
