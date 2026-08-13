-- Organic Intelligence persistence (0122): durable memory for the P1 engines.
--
-- WHY THESE SIX TABLES AND NOT ONE PER ENGINE
-- Cannibalisation findings, content-intelligence classifications and content
-- gaps are all OPPORTUNITY CLASSES, not separate universes — they share
-- identity, scoring, readiness, priority and lifecycle. Giving each its own
-- table would fragment the portfolio and make root-cause consolidation
-- impossible. Page ownership is 1:1 with a query cluster, so it lives on the
-- cluster row rather than in a table of its own.
--
-- THE CENTRAL DESIGN DECISION: STABLE SEMANTIC IDENTITY
-- Every durable object is keyed by a deterministic semantic key, never by a
-- sequence, run id or rank. The key must survive restart, redeploy, policy
-- rescoring, historical backfill and GSC/GA4/Merchant activation — otherwise
-- an opportunity loses its history and its work item the first time anything
-- changes, which is the whole failure mode this tranche exists to prevent.
--
-- THREE HASHES, DELIBERATELY DISTINCT
--   source_hash      the evidence as observed. Changes only when reality does.
--   semantic_hash    the meaning of the finding. Provider metadata timestamps
--                    must not churn it.
--   evaluation_hash  the scored result. A policy change moves THIS without
--                    touching source_hash — so "the algorithm changed" is
--                    permanently distinguishable from "demand changed".
--
-- UNKNOWN IS NOT ZERO
-- Every evidence-bearing numeric is NULLABLE with NO numeric default. A
-- DEFAULT 0 here would silently destroy the distinction the engines protect.
--
-- LOCK RISK: additive only (6 new tables + indexes). Safe online.

-- ── Materialisation runs ────────────────────────────────────────────────────

CREATE TABLE seo_intel_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL,
  status text NOT NULL DEFAULT 'STARTED',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- Versions in force for THIS run, so history stays explainable.
  policy_version text NOT NULL,
  engine_version text NOT NULL,
  materialisation_version integer NOT NULL,
  -- What the run actually did. Churn is measurable, which is how "unchanged
  -- state performs no domain write" stops being an aspiration.
  entities_evaluated integer NOT NULL DEFAULT 0,
  opportunities_created integer NOT NULL DEFAULT 0,
  opportunities_updated integer NOT NULL DEFAULT 0,
  opportunities_unchanged integer NOT NULL DEFAULT 0,
  opportunities_closed integer NOT NULL DEFAULT 0,
  history_events integer NOT NULL DEFAULT 0,
  work_items_created integer NOT NULL DEFAULT 0,
  work_items_updated integer NOT NULL DEFAULT 0,
  -- Provider evidence available at run time; absence is recorded, not assumed.
  evidence_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  CONSTRAINT seo_intel_runs_mode_chk CHECK (mode IN ('INCREMENTAL','FULL_REBUILD','BACKFILL','REPLAY')),
  CONSTRAINT seo_intel_runs_status_chk CHECK (status IN ('STARTED','COMPLETED','FAILED','ABANDONED','SKIPPED_LOCKED'))
);
CREATE INDEX seo_intel_runs_started_idx ON seo_intel_runs (started_at DESC);

-- ── Canonical opportunities ─────────────────────────────────────────────────

CREATE TABLE seo_intel_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Deterministic semantic identity. THE anchor for history, work items and
  -- provider enrichment.
  opportunity_key text NOT NULL,
  opportunity_class text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  entity_label text,

  root_cause_key text,

  policy_version text NOT NULL,
  engine_version text NOT NULL,
  materialisation_version integer NOT NULL,

  source_hash text NOT NULL,
  semantic_hash text NOT NULL,
  evaluation_hash text NOT NULL,

  -- Scores are nullable: an unscored opportunity (no usable evidence) is not
  -- a zero-scoring one.
  score numeric,
  adjusted_score numeric,
  unscored_weight_share numeric,

  commercial_readiness text NOT NULL DEFAULT 'UNKNOWN',
  seo_ready boolean,
  content_ready boolean,
  seo_blockers jsonb NOT NULL DEFAULT '[]'::jsonb,

  confidence text NOT NULL DEFAULT 'LOW',
  evidence_completeness numeric,
  evidence_available jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_missing jsonb NOT NULL DEFAULT '[]'::jsonb,

  effort text,
  risk text,
  priority_bucket text NOT NULL DEFAULT 'WATCH',
  recommended_action_class text,
  blocked_by jsonb NOT NULL DEFAULT '[]'::jsonb,

  status text NOT NULL DEFAULT 'OPEN',
  closed_reason text,

  work_item_id uuid REFERENCES seo_work_items(id),

  -- Temporal provenance. Observation time is NOT ingestion time: historical
  -- Search Console data arriving today must never look like a new event today.
  source_observed_at timestamptz,
  source_period_start date,
  source_period_end date,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_material_change_at timestamptz NOT NULL DEFAULT now(),
  ingested_at timestamptz NOT NULL DEFAULT now(),
  materialised_at timestamptz NOT NULL DEFAULT now(),

  created_run_id uuid REFERENCES seo_intel_runs(id),
  last_run_id uuid REFERENCES seo_intel_runs(id),

  CONSTRAINT seo_intel_opp_entity_chk CHECK (entity_type IN ('QUERY_CLUSTER','URL','PRODUCT','PRODUCT_FAMILY','CATEGORY','COMPATIBILITY','CONTENT','TEMPLATE')),
  CONSTRAINT seo_intel_opp_confidence_chk CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  CONSTRAINT seo_intel_opp_priority_chk CHECK (priority_bucket IN ('NOW','NEXT','WATCH','BLOCKED')),
  CONSTRAINT seo_intel_opp_status_chk CHECK (status IN ('OPEN','READY','WATCH','BLOCKED','ACTION_PENDING','ACTIONED','VERIFYING','RECOVERED','DECAYING','DECAYED','CLOSED')),
  CONSTRAINT seo_intel_opp_effort_chk CHECK (effort IS NULL OR effort IN ('TRIVIAL','LOW','MEDIUM','HIGH','STRUCTURAL')),
  CONSTRAINT seo_intel_opp_risk_chk CHECK (risk IS NULL OR risk IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  -- A closed opportunity must say why. Silent disappearance destroys the
  -- audit trail this table exists for.
  CONSTRAINT seo_intel_opp_closed_chk CHECK (status NOT IN ('CLOSED','DECAYED') OR closed_reason IS NOT NULL)
);
-- THE identity index. Plain (not partial) so ON CONFLICT (opportunity_key)
-- is unambiguous — the Guardian's partial-index trap is deliberately avoided.
CREATE UNIQUE INDEX seo_intel_opp_key_idx ON seo_intel_opportunities (opportunity_key);
CREATE INDEX seo_intel_opp_priority_idx ON seo_intel_opportunities (priority_bucket, adjusted_score DESC NULLS LAST) WHERE status NOT IN ('CLOSED','DECAYED');
CREATE INDEX seo_intel_opp_entity_idx ON seo_intel_opportunities (entity_type, entity_id);
CREATE INDEX seo_intel_opp_root_cause_idx ON seo_intel_opportunities (root_cause_key) WHERE root_cause_key IS NOT NULL;
CREATE INDEX seo_intel_opp_work_item_idx ON seo_intel_opportunities (work_item_id) WHERE work_item_id IS NOT NULL;

-- ── Score explainability ────────────────────────────────────────────────────

-- Why this scored what it did, under the policy in force AT THE TIME. Kept as
-- its own rows (not a jsonb blob) so a component can be queried across the
-- portfolio: "which opportunities are held back by CATALOGUE_DEPTH?"
CREATE TABLE seo_intel_score_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_key text NOT NULL,
  policy_version text NOT NULL,
  evaluation_hash text NOT NULL,
  component text NOT NULL,
  raw_evidence jsonb,
  evidence_state text NOT NULL,
  normalized numeric,
  weight numeric NOT NULL,
  contribution numeric NOT NULL,
  reason_code text NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_intel_sc_state_chk CHECK (evidence_state IN ('KNOWN','UNKNOWN','PARTIAL','STALE','NOT_APPLICABLE','MODELLED'))
);
-- One row per component per evaluation, so a re-score under a new policy adds
-- a generation rather than overwriting the old explanation.
CREATE UNIQUE INDEX seo_intel_sc_unique_idx ON seo_intel_score_components (opportunity_key, evaluation_hash, component);
CREATE INDEX seo_intel_sc_component_idx ON seo_intel_score_components (component, contribution DESC);

-- ── Material history ────────────────────────────────────────────────────────

-- Material transitions ONLY. A six-hourly identical reconciliation writes
-- nothing here; that is the point.
CREATE TABLE seo_intel_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_key text NOT NULL,
  run_id uuid REFERENCES seo_intel_runs(id),
  event_type text NOT NULL,
  from_state jsonb,
  to_state jsonb,
  reason text NOT NULL,
  policy_version text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_intel_hist_event_chk CHECK (event_type IN (
    'CREATED','SCORE_CHANGED','PRIORITY_CHANGED','READINESS_CHANGED','STATUS_CHANGED',
    'POLICY_REEVALUATED','EVIDENCE_ENRICHED','EVIDENCE_INVALIDATED','ROOT_CAUSE_ASSIGNED',
    'ROOT_CAUSE_REASSIGNED','WORK_ITEM_LINKED','DECAYED','CLOSED','SOURCE_REVISED'
  ))
);
CREATE INDEX seo_intel_hist_key_idx ON seo_intel_history (opportunity_key, occurred_at DESC);
CREATE INDEX seo_intel_hist_run_idx ON seo_intel_history (run_id);

-- ── Query clusters (ownership lives here — it is 1:1 with a cluster) ────────

CREATE TABLE seo_intel_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_key text NOT NULL,
  label text NOT NULL,
  cluster_method text NOT NULL,
  cluster_version integer NOT NULL DEFAULT 1,
  cluster_confidence numeric,
  membership_signature text NOT NULL,
  member_count integer NOT NULL DEFAULT 0,

  entity_id text,
  entity_type text,

  primary_intent text NOT NULL DEFAULT 'UNKNOWN',
  secondary_intent text,
  intent_confidence numeric,
  intent_method text,

  -- Page ownership.
  current_owner_url text,
  current_owner_type text,
  preferred_owner_url text,
  preferred_owner_type text,
  ownership_decision text,
  ownership_rationale text,

  -- Search evidence: NULL means UNKNOWN, never zero.
  impressions integer,
  clicks integer,
  ctr numeric,
  avg_position numeric,
  demand_state text NOT NULL DEFAULT 'UNKNOWN',

  source_observed_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_intel_cl_demand_chk CHECK (demand_state IN ('KNOWN','UNKNOWN','PARTIAL','STALE','NOT_APPLICABLE')),
  CONSTRAINT seo_intel_cl_method_chk CHECK (cluster_method IN ('RULE','ENTITY_MATCH','SEMANTIC','HYBRID')),
  -- Demand figures may only exist when demand is actually known.
  CONSTRAINT seo_intel_cl_unknown_chk CHECK (demand_state <> 'UNKNOWN' OR (impressions IS NULL AND clicks IS NULL))
);
CREATE UNIQUE INDEX seo_intel_cl_key_idx ON seo_intel_clusters (cluster_key);
CREATE INDEX seo_intel_cl_intent_idx ON seo_intel_clusters (primary_intent);
CREATE INDEX seo_intel_cl_owner_idx ON seo_intel_clusters (current_owner_url) WHERE current_owner_url IS NOT NULL;

-- ── AEO answer units ────────────────────────────────────────────────────────

CREATE TABLE seo_intel_answer_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Semantic identity, NOT the generated wording. Question text may be
  -- rephrased; the underlying question is the same object.
  answer_key text NOT NULL,
  template_id text,
  display_question text NOT NULL,
  intent text NOT NULL,
  answer_type text NOT NULL,

  readiness text NOT NULL DEFAULT 'DRAFT_ONLY',
  confidence text NOT NULL DEFAULT 'LOW',
  blocked_reason text,

  -- Fact references, not copied fact values: when the source changes the unit
  -- must re-evaluate rather than keep serving a stale copy.
  fact_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  unverified_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  category_entities jsonb NOT NULL DEFAULT '[]'::jsonb,

  fact_hash text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_evaluated_at timestamptz NOT NULL DEFAULT now(),
  last_material_change_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_intel_au_readiness_chk CHECK (readiness IN ('READY','PARTIAL','BLOCKED_BY_MISSING_FACT','DRAFT_ONLY')),
  -- READY is impossible while a required fact is missing. Enforced at the data
  -- layer as well as in the engine: no stale definitive answer may survive.
  CONSTRAINT seo_intel_au_ready_chk CHECK (readiness <> 'READY' OR missing_facts = '[]'::jsonb)
);
CREATE UNIQUE INDEX seo_intel_au_key_idx ON seo_intel_answer_units (answer_key);
CREATE INDEX seo_intel_au_readiness_idx ON seo_intel_answer_units (readiness);
