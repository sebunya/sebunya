-- 0141 — Measurement operations, collector contract and attribution (additive).
-- Replay accounting: a replayed delivery gets a fresh attempt budget and
-- horizon from the replay, without rewriting its history.
ALTER TABLE measurement.delivery_intent ADD COLUMN IF NOT EXISTS replay_count integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE measurement.delivery_intent ADD COLUMN IF NOT EXISTS attempts_at_replay integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE measurement.delivery_intent ADD COLUMN IF NOT EXISTS replayed_at timestamptz;
--> statement-breakpoint
-- Browser collector contract (dossier §7.1): a batch id is answered once;
-- reused with different content → 409.
CREATE TABLE IF NOT EXISTS measurement.collector_batch (
  batch_id uuid PRIMARY KEY,
  content_sha256 char(64) NOT NULL,
  receipt_id uuid NOT NULL,
  page_instance_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  accepted integer NOT NULL,
  rejected integer NOT NULL,
  results jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS collector_batch_received_idx ON measurement.collector_batch (received_at);
--> statement-breakpoint
-- Acquisition touchpoints (landings from ads, search, social, referrals), the
-- journeys attribution reads. Visitor = first-party id; no raw click ids here.
CREATE TABLE IF NOT EXISTS measurement.touchpoint (
  touch_id uuid PRIMARY KEY,
  environment text NOT NULL,
  anonymous_id text NOT NULL,
  client_event_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  channel text NOT NULL,
  source text,
  medium text,
  campaign text,
  referrer_host text,
  landing_path text,
  click_id_types text[] NOT NULL DEFAULT '{}',
  traffic_class text NOT NULL DEFAULT 'customer',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, anonymous_id, client_event_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS touchpoint_visitor_idx ON measurement.touchpoint (anonymous_id, occurred_at);
--> statement-breakpoint
-- Attribution runs (observational; dossier §9.2–9.5).
CREATE TABLE IF NOT EXISTS measurement.attribution_run (
  run_id uuid PRIMARY KEY,
  method text NOT NULL,
  method_version text NOT NULL,
  policy jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING','COMPLETE','INSUFFICIENT_DATA','NOT_IDENTIFIABLE','DATA_INVALID','FAILED')),
  input_orders integer NOT NULL DEFAULT 0,
  covered_orders integer NOT NULL DEFAULT 0,
  input_journeys integer NOT NULL DEFAULT 0,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS measurement.attribution_result (
  run_id uuid NOT NULL REFERENCES measurement.attribution_run(run_id),
  order_id text NOT NULL,
  channel text NOT NULL,
  weight numeric NOT NULL,
  allocated_ugx bigint NOT NULL,
  PRIMARY KEY (run_id, order_id, channel)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS measurement.attribution_channel (
  run_id uuid NOT NULL REFERENCES measurement.attribution_run(run_id),
  channel text NOT NULL,
  value numeric NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (run_id, channel)
);
--> statement-breakpoint
-- Host-wide analytics lease + run history (addendum §2, §6): one bounded
-- analytics job at a time across every container.
CREATE TABLE IF NOT EXISTS measurement.analytics_lease (
  name text PRIMARY KEY,
  holder text NOT NULL,
  lease_until timestamptz NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS measurement.batch_run (
  run_id uuid PRIMARY KEY,
  job text NOT NULL,
  state text NOT NULL CHECK (state IN ('DUE','CHECKING','RUNNING','PUBLISHING','COMPLETE','DEFERRED_RESOURCE','CHECKPOINTED','FAILED','CANCELLED')),
  reason text,
  resources jsonb NOT NULL DEFAULT '{}'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS batch_run_job_idx ON measurement.batch_run (job, started_at DESC);
