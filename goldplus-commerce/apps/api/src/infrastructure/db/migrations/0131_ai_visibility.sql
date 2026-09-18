-- 0131 — AI Search Visibility (AEO/GEO) operating layer.
--
-- Additive only: ten new aiv_* tables, no existing table altered. Reversible by
-- dropping them (see the DOWN block at the end, kept commented).
--
-- Model: project -> queries x providers -> run -> observation (one answer) ->
-- citations + mentions (independent measures) -> actions. Observations,
-- citations and mentions are INSERT-only: a later run never rewrites an
-- earlier one. Competitors are NOT duplicated: a project pins rows of the
-- existing seo_competitors registry.
--
-- Provider API keys are stored AES-256-GCM encrypted by the existing
-- IntegrationCredentialVault; only the ciphertext and a mask are stored, and
-- neither is ever returned by the API.

CREATE TABLE IF NOT EXISTS aiv_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  brand_name text NOT NULL,
  brand_aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  market_country text NOT NULL DEFAULT 'UG',
  market_city text,
  language text NOT NULL DEFAULT 'en',
  -- spend governance (USD)
  max_queries_per_run integer NOT NULL DEFAULT 50 CHECK (max_queries_per_run BETWEEN 1 AND 1000),
  max_spend_per_run_usd numeric(10,4) NOT NULL DEFAULT 2 CHECK (max_spend_per_run_usd >= 0),
  max_daily_spend_usd numeric(10,4) NOT NULL DEFAULT 5 CHECK (max_daily_spend_usd >= 0),
  max_monthly_spend_usd numeric(10,4) NOT NULL DEFAULT 30 CHECK (max_monthly_spend_usd >= 0),
  approval_above_usd numeric(10,4) NOT NULL DEFAULT 1 CHECK (approval_above_usd >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aiv_project_competitors (
  project_id uuid NOT NULL REFERENCES aiv_projects(id) ON DELETE CASCADE,
  competitor_id uuid NOT NULL REFERENCES seo_competitors(id) ON DELETE CASCADE,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, competitor_id)
);

CREATE TABLE IF NOT EXISTS aiv_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES aiv_projects(id) ON DELETE CASCADE,
  provider text NOT NULL CONSTRAINT aiv_provider_configs_provider_chk CHECK (provider IN ('OPENAI','ANTHROPIC','GEMINI','PERPLEXITY')),
  enabled boolean NOT NULL DEFAULT false,
  model text NOT NULL,
  web_search boolean NOT NULL DEFAULT true,
  -- conservative upper-bound estimate per call, used for pre-run budget checks
  est_usd_per_call numeric(10,5) NOT NULL DEFAULT 0.05 CHECK (est_usd_per_call >= 0),
  monthly_cap_usd numeric(10,4) CHECK (monthly_cap_usd IS NULL OR monthly_cap_usd >= 0),
  credential_ciphertext text,
  credential_mask text,
  credential_updated_at timestamptz,
  last_health_status text CONSTRAINT aiv_provider_configs_health_chk CHECK (last_health_status IS NULL OR last_health_status IN ('OK','FAILED')),
  last_health_message text,
  last_health_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, provider)
);

CREATE TABLE IF NOT EXISTS aiv_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES aiv_projects(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 3 AND 500),
  normalized_text text NOT NULL,
  category text,
  intent text NOT NULL DEFAULT 'UNKNOWN' CONSTRAINT aiv_queries_intent_chk CHECK (intent IN ('COMMERCIAL','INFORMATIONAL','NAVIGATIONAL','TRANSACTIONAL','LOCAL','COMPARISON','UNKNOWN')),
  funnel_stage text CONSTRAINT aiv_queries_funnel_chk CHECK (funnel_stage IS NULL OR funnel_stage IN ('AWARENESS','CONSIDERATION','DECISION','POST_PURCHASE')),
  branded boolean NOT NULL DEFAULT false,
  topic text,
  property text,
  market_country text,
  market_city text,
  language text,
  source text NOT NULL DEFAULT 'MANUAL' CONSTRAINT aiv_queries_source_chk CHECK (source IN ('MANUAL','SEARCH_CONSOLE','RESEARCH','AEO_PROMPT_BANK','IMPORT')),
  provenance text,
  priority text NOT NULL DEFAULT 'P2' CONSTRAINT aiv_queries_priority_chk CHECK (priority IN ('P0','P1','P2','P3')),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, normalized_text)
);
CREATE INDEX IF NOT EXISTS aiv_queries_project_active_idx ON aiv_queries (project_id, active);

CREATE TABLE IF NOT EXISTS aiv_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES aiv_projects(id) ON DELETE CASCADE,
  -- MONITOR feeds KPIs; RESEARCH never does; VERIFICATION re-measures an action.
  kind text NOT NULL DEFAULT 'MONITOR' CONSTRAINT aiv_runs_kind_chk CHECK (kind IN ('MONITOR','RESEARCH','VERIFICATION')),
  status text NOT NULL CONSTRAINT aiv_runs_status_chk CHECK (status IN ('AWAITING_APPROVAL','QUEUED','RUNNING','PARTIAL','COMPLETED','FAILED','CANCELLED','REJECTED')),
  idempotency_key text NOT NULL,
  providers jsonb NOT NULL DEFAULT '[]'::jsonb,
  query_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- research runs may ask ad-hoc questions that are NOT tracked queries
  adhoc_queries jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_tasks integer NOT NULL DEFAULT 0,
  succeeded integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  estimated_usd numeric(10,4) NOT NULL DEFAULT 0,
  actual_usd numeric(10,4) NOT NULL DEFAULT 0,
  phase text,
  error text,
  requested_by uuid,
  actor_kind text NOT NULL DEFAULT 'USER' CONSTRAINT aiv_runs_actor_chk CHECK (actor_kind IN ('USER','SYSTEM','AGENT','SCHEDULER','API_KEY','WEBHOOK')),
  approved_by uuid,
  approved_at timestamptz,
  action_id uuid,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (project_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS aiv_runs_project_created_idx ON aiv_runs (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS aiv_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES aiv_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES aiv_projects(id) ON DELETE CASCADE,
  run_kind text NOT NULL,
  query_id uuid REFERENCES aiv_queries(id) ON DELETE SET NULL,
  query_text text NOT NULL,
  provider text NOT NULL,
  model text,
  status text NOT NULL CONSTRAINT aiv_observations_status_chk CHECK (status IN ('SUCCEEDED','FAILED','SKIPPED')),
  error_code text,
  error_message text,
  answer_text text,
  citation_support text CONSTRAINT aiv_observations_cs_chk CHECK (citation_support IS NULL OR citation_support IN ('SUPPORTED','UNSUPPORTED')),
  brand_mentioned boolean,
  -- NULL = provider exposed no citation data; FALSE = it did and we were not cited
  own_cited boolean,
  citation_count integer NOT NULL DEFAULT 0,
  requested_location text,
  applied_location text,
  latency_ms integer,
  input_tokens integer,
  output_tokens integer,
  search_calls integer,
  cost_usd numeric(10,5),
  raw_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, query_text, provider)
);
CREATE INDEX IF NOT EXISTS aiv_obs_project_time_idx ON aiv_observations (project_id, run_kind, executed_at DESC);
CREATE INDEX IF NOT EXISTS aiv_obs_query_provider_idx ON aiv_observations (query_id, provider, executed_at DESC);

CREATE TABLE IF NOT EXISTS aiv_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id uuid NOT NULL REFERENCES aiv_observations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES aiv_projects(id) ON DELETE CASCADE,
  position integer,
  url text NOT NULL,
  title text,
  host text NOT NULL,
  page_key text NOT NULL,
  role text NOT NULL CONSTRAINT aiv_citations_role_chk CHECK (role IN ('OWN','COMPETITOR','THIRD_PARTY')),
  competitor_id uuid,
  source_kind text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aiv_citations_obs_idx ON aiv_citations (observation_id);
CREATE INDEX IF NOT EXISTS aiv_citations_project_host_idx ON aiv_citations (project_id, host);

CREATE TABLE IF NOT EXISTS aiv_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  observation_id uuid NOT NULL REFERENCES aiv_observations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES aiv_projects(id) ON DELETE CASCADE,
  entity_kind text NOT NULL CONSTRAINT aiv_mentions_kind_chk CHECK (entity_kind IN ('BRAND','COMPETITOR')),
  competitor_id uuid,
  matched_text text NOT NULL,
  first_index integer NOT NULL,
  occurrences integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aiv_mentions_obs_idx ON aiv_mentions (observation_id);

CREATE TABLE IF NOT EXISTS aiv_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES aiv_projects(id) ON DELETE CASCADE,
  category text NOT NULL CONSTRAINT aiv_actions_category_chk CHECK (category IN ('CONTENT_CHANGE','METADATA_CHANGE','SCHEMA_CHANGE','INTERNAL_LINK_CHANGE','CODE_CHANGE','QUERY_TRACKING_CHANGE','COMPETITOR_TRACKING_CHANGE','MEASUREMENT_RUN','INDEXING_SUBMISSION','REPORT_GENERATION','OTHER')),
  risk text NOT NULL CONSTRAINT aiv_actions_risk_chk CHECK (risk IN ('MEASURE','CONFIGURE','EDIT','PUBLISH','DESTRUCTIVE')),
  status text NOT NULL CONSTRAINT aiv_actions_status_chk CHECK (status IN ('DRAFT','AWAITING_APPROVAL','APPROVED','REJECTED','EXECUTING','COMPLETED','FAILED','VERIFICATION_PENDING','VERIFIED','NOT_VERIFIED','CANCELLED')),
  title text NOT NULL,
  reason text NOT NULL,
  mechanism text,
  plan text,
  target_page text,
  expected_impact text,
  limitations text,
  confidence text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  query_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  baseline jsonb,
  verification jsonb,
  result text,
  rollback text,
  proposed_by uuid,
  proposer_kind text NOT NULL DEFAULT 'USER',
  approved_by uuid,
  approved_at timestamptz,
  executed_by uuid,
  executed_at timestamptz,
  verify_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aiv_actions_project_status_idx ON aiv_actions (project_id, status);

CREATE TABLE IF NOT EXISTS aiv_action_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL REFERENCES aiv_actions(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid,
  actor_kind text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aiv_action_events_action_idx ON aiv_action_events (action_id, created_at);

-- The shop's own project: its real brand and domain.
INSERT INTO aiv_projects (slug, name, brand_name, brand_aliases, domains)
VALUES ('goldplus', 'GoldPlus', 'GoldPlus', '["Gold Plus","ShopGoldPlus","shopgoldplus.com"]'::jsonb, '["shopgoldplus.com"]'::jsonb)
ON CONFLICT (slug) DO NOTHING;

-- Pin the competitors the owner curated (active, each with a website).
INSERT INTO aiv_project_competitors (project_id, competitor_id)
SELECT p.id, c.id FROM aiv_projects p, seo_competitors c
WHERE p.slug = 'goldplus' AND c.status = 'ACTIVE' AND jsonb_array_length(c.domains) > 0
ON CONFLICT DO NOTHING;

-- Carry the AEO prompt bank's questions over as tracked queries (one per text).
INSERT INTO aiv_queries (project_id, text, normalized_text, category, intent, source, provenance)
SELECT DISTINCT ON (lower(btrim(a.prompt))) p.id, btrim(a.prompt), lower(btrim(a.prompt)), a.category,
       CASE WHEN a.intent IN ('COMMERCIAL','INFORMATIONAL','NAVIGATIONAL','TRANSACTIONAL','LOCAL','COMPARISON') THEN a.intent ELSE 'UNKNOWN' END,
       'AEO_PROMPT_BANK', 'seo_aeo_prompts'
FROM seo_aeo_prompts a, aiv_projects p
WHERE p.slug = 'goldplus'
ORDER BY lower(btrim(a.prompt)), a.created_at
ON CONFLICT (project_id, normalized_text) DO NOTHING;

-- Provider slots, disabled until a key is supplied. Estimates are deliberately
-- conservative upper bounds per call (answer + web search), used only to
-- block over-budget runs before they start.
INSERT INTO aiv_provider_configs (project_id, provider, model, est_usd_per_call)
SELECT p.id, v.provider, v.model, v.est FROM aiv_projects p,
  (VALUES ('OPENAI','gpt-4.1-mini',0.04), ('ANTHROPIC','claude-sonnet-5',0.05), ('GEMINI','gemini-2.5-flash',0.04), ('PERPLEXITY','sonar',0.02)) AS v(provider, model, est)
WHERE p.slug = 'goldplus'
ON CONFLICT (project_id, provider) DO NOTHING;

-- DOWN (manual, if ever needed):
-- DROP TABLE aiv_action_events, aiv_actions, aiv_mentions, aiv_citations, aiv_observations, aiv_runs, aiv_queries, aiv_provider_configs, aiv_project_competitors, aiv_projects;
