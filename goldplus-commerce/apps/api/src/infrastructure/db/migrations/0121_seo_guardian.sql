-- Search Console Guardian (0121): the decision layer's memory.
--
-- WHY
-- GoldPlus already had sensors and an alert table. What it lacked was the state
-- a restrained agent needs BETWEEN runs:
--
--  * seo_guardian_runs    — the heartbeat. Proves the six-hourly cadence ran,
--                           what it saw, and why it did (or did not) act. A run
--                           that changed nothing is still recorded, because
--                           "no material change" is a result, not an absence.
--  * seo_guardian_signals — hysteresis persistence. Without a durable
--                           consecutive-observation count the agent cannot tell
--                           a one-off reading from a persistent problem, and
--                           flaps an incident every six hours.
--  * seo_guardian_policy  — kill switches, change budgets and the autonomy
--                           level each remediation CLASS has earned. Autonomy
--                           is per-class and earned, never a global boolean.
--  * seo_guardian_actions — the evidence chain: what was decided, whether it
--                           was allowed, what happened, and whether it verified.
--
-- Incidents deliberately REUSE the existing seo_alerts table (it already has
-- dedupe_key + OPEN/ACKNOWLEDGED/RESOLVED + first/last_seen). No second
-- incident system is introduced.
--
-- LOCK RISK: additive only (4 new tables + indexes). Safe online.

CREATE TABLE seo_guardian_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'RUNNING',
  -- What the run could actually see.
  freshness text,
  freshness_lag_days integer,
  comparison_valid boolean,
  latest_source_date date,
  -- What it concluded.
  signals_evaluated integer NOT NULL DEFAULT 0,
  material_changes integer NOT NULL DEFAULT 0,
  incidents_opened integer NOT NULL DEFAULT 0,
  actions_attempted integer NOT NULL DEFAULT 0,
  actions_failed integer NOT NULL DEFAULT 0,
  circuit_state text NOT NULL DEFAULT 'CLOSED',
  circuit_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  notification_sent boolean NOT NULL DEFAULT false,
  notification_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_version text NOT NULL,
  error text,
  CONSTRAINT seo_guardian_runs_status_chk CHECK (status IN ('RUNNING','COMPLETED','FAILED','SKIPPED_LOCKED')),
  CONSTRAINT seo_guardian_runs_freshness_chk CHECK (freshness IS NULL OR freshness IN ('COMPLETE','PARTIAL','DELAYED','STALE','UNKNOWN')),
  CONSTRAINT seo_guardian_runs_circuit_chk CHECK (circuit_state IN ('CLOSED','OPEN','HALF_OPEN'))
);
CREATE INDEX seo_guardian_runs_agent_idx ON seo_guardian_runs (agent, started_at DESC);

-- One row per tracked condition. The idempotency key is the identity, so the
-- same unresolved condition updates its row rather than creating a new one.
CREATE TABLE seo_guardian_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  agent text NOT NULL,
  entity text NOT NULL,
  change_type text NOT NULL,
  state text NOT NULL DEFAULT 'FIRST_OBSERVED',
  consecutive_observations integer NOT NULL DEFAULT 0,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  last_absent_at timestamptz,
  confirmed_at timestamptz,
  recovered_at timestamptz,
  -- The measurement behind the current state, kept for the evidence graph.
  baseline_value numeric,
  current_value numeric,
  relative_change numeric,
  absolute_change numeric,
  materiality text,
  commercially_important boolean NOT NULL DEFAULT false,
  alert_id uuid REFERENCES seo_alerts(id),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_guardian_signals_state_chk CHECK (state IN ('FIRST_OBSERVED','PENDING_CONFIRMATION','CONFIRMED','ONGOING','RECOVERING','RECOVERED')),
  CONSTRAINT seo_guardian_signals_materiality_chk CHECK (materiality IS NULL OR materiality IN ('MATERIAL','IMMATERIAL','INSUFFICIENT_BASELINE','NOT_COMPARABLE'))
);
CREATE UNIQUE INDEX seo_guardian_signals_key_idx ON seo_guardian_signals (idempotency_key);
CREATE INDEX seo_guardian_signals_state_idx ON seo_guardian_signals (state, last_observed_at DESC);

-- Singleton-ish governed configuration. Kill switches and budgets live in the
-- database so an operator can stop the agent without a redeploy.
CREATE TABLE seo_guardian_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT 'GLOBAL',
  organic_agents_enabled boolean NOT NULL DEFAULT true,
  autonomous_writes_enabled boolean NOT NULL DEFAULT false,
  external_writes_enabled boolean NOT NULL DEFAULT false,
  content_autopublish_enabled boolean NOT NULL DEFAULT false,
  email_notifications_enabled boolean NOT NULL DEFAULT true,
  -- Safe by default: the agent observes and recommends until an operator
  -- deliberately grants it more.
  observe_only_mode boolean NOT NULL DEFAULT true,
  change_budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  materiality_thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { "<remediation_class>": { "earnedLevel": 0..4, "canaryComplete": bool } }
  autonomy_by_class jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX seo_guardian_policy_scope_idx ON seo_guardian_policy (scope);

CREATE TABLE seo_guardian_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES seo_guardian_runs(id),
  signal_id uuid REFERENCES seo_guardian_signals(id),
  idempotency_key text NOT NULL,
  remediation_class text NOT NULL,
  tier text NOT NULL,
  mode text,
  decision text NOT NULL,
  decision_reason text,
  entity text,
  proposed_urls integer NOT NULL DEFAULT 0,
  executed_at timestamptz,
  outcome text,
  outcome_detail text,
  verified_at timestamptz,
  verification text,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_guardian_actions_tier_chk CHECK (tier IN ('TIER_0_OBSERVE','TIER_1_INTERNAL','TIER_2_REVERSIBLE','TIER_3_STRUCTURAL','TIER_4_DESTRUCTIVE')),
  CONSTRAINT seo_guardian_actions_decision_chk CHECK (decision IN ('ALLOWED','DENIED')),
  CONSTRAINT seo_guardian_actions_mode_chk CHECK (mode IS NULL OR mode IN ('CANARY','FULL')),
  CONSTRAINT seo_guardian_actions_outcome_chk CHECK (outcome IS NULL OR outcome IN ('SUCCEEDED','FAILED','SKIPPED')),
  CONSTRAINT seo_guardian_actions_verification_chk CHECK (verification IS NULL OR verification IN ('VERIFIED','NOT_VERIFIED','NOT_APPLICABLE','PENDING')),
  -- An executed action must record what happened to it.
  CONSTRAINT seo_guardian_actions_executed_chk CHECK (executed_at IS NULL OR outcome IS NOT NULL)
);
CREATE UNIQUE INDEX seo_guardian_actions_key_idx ON seo_guardian_actions (idempotency_key);
CREATE INDEX seo_guardian_actions_run_idx ON seo_guardian_actions (run_id);
