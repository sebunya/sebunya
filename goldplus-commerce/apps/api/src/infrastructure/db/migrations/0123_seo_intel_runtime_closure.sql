-- Organic Intelligence runtime closure (0123).
--
-- 0122 gave opportunities, components, history, clusters and answer units a
-- home. Four capabilities still had engines with nowhere to persist:
-- query membership, cannibalisation findings, content intelligence and
-- action requests. Content GAPS deliberately reuse seo_intel_opportunities
-- (a gap IS an opportunity of class CREATE_CONTENT) rather than getting a
-- table of their own — splitting them would fragment the portfolio and break
-- root-cause consolidation.
--
-- Every table follows the 0122 conventions: a deterministic semantic key with
-- a PLAIN unique index (so ON CONFLICT is unambiguous), evidence numerics
-- nullable with no numeric default, and observation time separate from
-- ingestion time.
--
-- LOCK RISK: additive only (4 new tables + indexes). Safe online.

-- ── Query membership ────────────────────────────────────────────────────────

CREATE TABLE seo_intel_query_membership (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_key text NOT NULL,
  cluster_key text NOT NULL,
  raw_query text NOT NULL,
  normalized_query text NOT NULL,
  membership_method text NOT NULL,
  membership_confidence numeric,
  -- Provenance: a historical backfill row must never look like a live event.
  source text NOT NULL,
  source_observed_at timestamptz,
  is_backfill boolean NOT NULL DEFAULT false,
  impressions integer,
  clicks integer,
  demand_state text NOT NULL DEFAULT 'UNKNOWN',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_intel_qm_method_chk CHECK (membership_method IN ('RULE','ENTITY_MATCH','SEMANTIC','HYBRID')),
  CONSTRAINT seo_intel_qm_demand_chk CHECK (demand_state IN ('KNOWN','UNKNOWN','PARTIAL','STALE','NOT_APPLICABLE')),
  CONSTRAINT seo_intel_qm_unknown_chk CHECK (demand_state <> 'UNKNOWN' OR (impressions IS NULL AND clicks IS NULL))
);
CREATE UNIQUE INDEX seo_intel_qm_key_idx ON seo_intel_query_membership (membership_key);
CREATE INDEX seo_intel_qm_cluster_idx ON seo_intel_query_membership (cluster_key);

-- ── Cannibalisation findings ────────────────────────────────────────────────

CREATE TABLE seo_intel_cannibalisation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_key text NOT NULL,
  cluster_key text,
  classification text NOT NULL,
  confidence numeric,
  rationale text NOT NULL,
  affected_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  persistence integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN',
  opportunity_key text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_material_change_at timestamptz NOT NULL DEFAULT now(),
  resolved_reason text,
  CONSTRAINT seo_intel_can_class_chk CHECK (classification IN (
    'BENIGN_MULTI_URL','INTENT_SPLIT','TRUE_CANNIBALISATION','CANONICAL_CONFLICT',
    'CONTENT_OVERLAP','INTERNAL_LINK_SIGNAL_PROBLEM','LIFECYCLE_CONFLICT',
    'TEMPORARY_RANKING_VARIANCE','INSUFFICIENT_EVIDENCE'
  )),
  CONSTRAINT seo_intel_can_status_chk CHECK (status IN ('OPEN','MONITORING','RESOLVED','SUPERSEDED')),
  CONSTRAINT seo_intel_can_resolved_chk CHECK (status <> 'RESOLVED' OR resolved_reason IS NOT NULL)
);
CREATE UNIQUE INDEX seo_intel_can_key_idx ON seo_intel_cannibalisation (finding_key);
CREATE INDEX seo_intel_can_class_idx ON seo_intel_cannibalisation (classification, status);

-- ── Content intelligence ────────────────────────────────────────────────────

CREATE TABLE seo_intel_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_key text NOT NULL,
  url text NOT NULL,
  page_purpose text,
  primary_intent text,
  cluster_key text,
  classification text NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE',
  catalogue_relevance text,
  content_completeness numeric,
  commercial_value text,
  internal_link_role text,
  schema_eligibility text,
  performance_state text,
  semantic_hash text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_material_change_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_intel_content_class_chk CHECK (classification IN (
    'PERFORMING','IMPROVING','DECAYING','THIN','DUPLICATIVE','OUTDATED',
    'MISALIGNED','HIGH_POTENTIAL','MISSING','INSUFFICIENT_EVIDENCE'
  ))
);
CREATE UNIQUE INDEX seo_intel_content_key_idx ON seo_intel_content (content_key);
CREATE INDEX seo_intel_content_class_idx ON seo_intel_content (classification);

-- ── Action requests ─────────────────────────────────────────────────────────

-- Persistence is NOT authorisation. Autonomy remains level 0; these rows record
-- what the system would propose and why it was denied or deferred.
CREATE TABLE seo_intel_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL,
  opportunity_key text NOT NULL,
  action_class text NOT NULL,
  entity_id text NOT NULL,
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_version text NOT NULL,
  preconditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  unmet_preconditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence text NOT NULL,
  blast_radius integer NOT NULL DEFAULT 0,
  expected_effect text,
  rollback_class text NOT NULL,
  verification_plan text,
  state text NOT NULL,
  decision_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_intel_ar_state_chk CHECK (state IN (
    'PROPOSED','DENIED','DEFERRED','APPROVAL_REQUIRED','NOT_AUTHORISED'
  )),
  CONSTRAINT seo_intel_ar_rollback_chk CHECK (rollback_class IN ('NONE_REQUIRED','AUTOMATIC','MANUAL','IRREVERSIBLE')),
  -- Nothing may be recorded as executable while autonomy is level 0.
  CONSTRAINT seo_intel_ar_no_execution_chk CHECK (state <> 'PROPOSED' OR decision_reason IS NOT NULL)
);
CREATE UNIQUE INDEX seo_intel_ar_key_idx ON seo_intel_action_requests (request_key);
CREATE INDEX seo_intel_ar_opp_idx ON seo_intel_action_requests (opportunity_key);

-- ── Root-cause revisability (§15) ───────────────────────────────────────────

-- A root-cause grouping is a conclusion, not eternal truth. Reassignment must
-- keep its history rather than silently overwriting the earlier belief.
ALTER TABLE seo_intel_history
  DROP CONSTRAINT IF EXISTS seo_intel_hist_event_chk;
ALTER TABLE seo_intel_history
  ADD CONSTRAINT seo_intel_hist_event_chk CHECK (event_type IN (
    'CREATED','SCORE_CHANGED','PRIORITY_CHANGED','READINESS_CHANGED','STATUS_CHANGED',
    'POLICY_REEVALUATED','EVIDENCE_ENRICHED','EVIDENCE_INVALIDATED','ROOT_CAUSE_ASSIGNED',
    'ROOT_CAUSE_REASSIGNED','WORK_ITEM_LINKED','DECAYED','CLOSED','SOURCE_REVISED',
    'CLUSTER_ENRICHED','OWNERSHIP_CHANGED','ANSWER_READINESS_CHANGED','CANNIBALISATION_CLASSIFIED'
  ));
