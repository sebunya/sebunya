-- 0154 — Advertising operations (docs/advertising/README.md).
--
-- Extends the advertising destinations (0138) with what running ads needs
-- beyond browser conversions:
--   * a Test/Live mode and a per-destination choice of optimisation events;
--   * per-platform capability settings (audiences, spend import, offline
--     conversions), each with its own write-only credential;
--   * Customer Match / Custom Audience list ids and an insert-only run log;
--   * clicks, impressions and a campaign label on the ONE canonical spend
--     table (media_cost_facts, 0102), plus an import log;
--   * admin-recorded phone/WhatsApp sales (hashes only, never plaintext
--     contact details) and one idempotent row per offline conversion;
--   * a once-per-day claim table so scheduled jobs never run twice.
--
-- ADDITIVE ONLY: new tables, nullable columns or columns with defaults. Old
-- code ignores all of it. No INSERTs.
--
-- Rollback:
--   DROP TABLE IF EXISTS ad_job_claims, ad_offline_conversions, ad_offline_sales,
--     ad_spend_imports, ad_audience_runs, ad_audience_lists, ad_destination_capabilities;
--   ALTER TABLE media_cost_facts DROP COLUMN IF EXISTS clicks, DROP COLUMN IF EXISTS impressions,
--     DROP COLUMN IF EXISTS campaign_label;
--   ALTER TABLE ad_destinations DROP COLUMN IF EXISTS mode, DROP COLUMN IF EXISTS event_selection;
ALTER TABLE ad_destinations ADD COLUMN IF NOT EXISTS mode varchar(8) NOT NULL DEFAULT 'live';
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE ad_destinations ADD CONSTRAINT ad_destinations_mode_chk CHECK (mode IN ('live', 'test'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
-- NULL = every early-signal event the platform supports (the 0138 behaviour).
ALTER TABLE ad_destinations ADD COLUMN IF NOT EXISTS event_selection jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ad_destination_capabilities (
  platform     varchar(32) NOT NULL,
  capability   varchar(16) NOT NULL CHECK (capability IN ('audiences', 'spend', 'offline')),
  enabled      boolean NOT NULL DEFAULT false,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_enc   text,
  secret_mask  varchar(40),
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  last_run_at  timestamptz,
  last_status  varchar(24),
  last_error   text,
  PRIMARY KEY (platform, capability)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ad_audience_lists (
  platform        varchar(32) NOT NULL,
  segment         varchar(24) NOT NULL,
  remote_list_id  varchar(200) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, segment)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ad_audience_runs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform                varchar(32) NOT NULL,
  segment                 varchar(24) NOT NULL,
  mode                    varchar(8) NOT NULL CHECK (mode IN ('DRY_RUN', 'SYNC')),
  trigger                 varchar(12) NOT NULL CHECK (trigger IN ('ADMIN', 'SCHEDULE')),
  status                  varchar(24) NOT NULL,
  eligible_count          integer NOT NULL DEFAULT 0,
  excluded_consent        integer NOT NULL DEFAULT 0,
  excluded_no_identifier  integer NOT NULL DEFAULT 0,
  uploaded_count          integer,
  message                 text,
  remote_list_id          varchar(200),
  actor_id                uuid,
  started_at              timestamptz NOT NULL,
  finished_at             timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ad_audience_runs_recent_idx ON ad_audience_runs (platform, segment, finished_at DESC);
--> statement-breakpoint
ALTER TABLE media_cost_facts ADD COLUMN IF NOT EXISTS clicks bigint;
--> statement-breakpoint
ALTER TABLE media_cost_facts ADD COLUMN IF NOT EXISTS impressions bigint;
--> statement-breakpoint
-- The campaign's display name when `campaign` holds a stable platform id.
ALTER TABLE media_cost_facts ADD COLUMN IF NOT EXISTS campaign_label varchar(150);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE media_cost_facts ADD CONSTRAINT media_cost_facts_counts_nonneg CHECK ((clicks IS NULL OR clicks >= 0) AND (impressions IS NULL OR impressions >= 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ad_spend_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      varchar(32) NOT NULL,
  trigger       varchar(12) NOT NULL CHECK (trigger IN ('ADMIN', 'SCHEDULE', 'CSV')),
  status        varchar(24) NOT NULL,
  date_from     date,
  date_to       date,
  rows_written  integer NOT NULL DEFAULT 0,
  message       text,
  actor_id      uuid,
  started_at    timestamptz NOT NULL,
  finished_at   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ad_spend_imports_recent_idx ON ad_spend_imports (finished_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ad_offline_sales (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel                varchar(12) NOT NULL CHECK (channel IN ('PHONE', 'WHATSAPP')),
  occurred_at            timestamptz NOT NULL,
  value_ugx              bigint NOT NULL CHECK (value_ugx > 0),
  order_id               uuid REFERENCES orders(id),
  email_sha256           char(64),
  email_google_sha256    char(64),
  phone_digits_sha256    char(64),
  phone_plus_sha256      char(64),
  consent_user_ids       jsonb NOT NULL DEFAULT '[]'::jsonb,
  consent_fp_client_ids  jsonb NOT NULL DEFAULT '[]'::jsonb,
  note                   varchar(300),
  recorded_by            uuid,
  recorded_at            timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ad_offline_conversions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform         varchar(32) NOT NULL,
  source           varchar(16) NOT NULL CHECK (source IN ('COD_DELIVERED', 'ADMIN_SALE')),
  source_ref       varchar(64) NOT NULL,
  event_id         varchar(64) NOT NULL,
  occurred_at      timestamptz NOT NULL,
  state            varchar(20) NOT NULL DEFAULT 'PENDING'
                   CHECK (state IN ('PENDING', 'SENT', 'DUPLICATE_ONLINE', 'SUPPRESSED', 'FAILED', 'SKIPPED', 'EXPIRED')),
  reason           varchar(300),
  attempt_count    integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, source, source_ref)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ad_offline_conversions_due_idx ON ad_offline_conversions (next_attempt_at) WHERE state = 'PENDING';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ad_job_claims (
  job_key     varchar(120) PRIMARY KEY,
  claimed_at  timestamptz NOT NULL DEFAULT now()
);
