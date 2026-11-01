-- Organic Growth OS — SEO data layer (competitors, queries, SERP evidence,
-- gaps, opportunities, change ledger, integrations, crawl, link graph, AEO,
-- SERP domains, alerts, experiments, keyword imports).
--
-- WHY
-- The storefront currently has redirects + gsc_performance (0074) and nothing
-- else: no competitor registry, no query inventory, no SERP evidence store, no
-- gap/opportunity tracking, no crawl or link-graph facts, no AEO observation
-- log. Every table here stores OBSERVED or MANAGEMENT_SUPPLIED evidence with an
-- explicit evidence/confidence state — no fabricated rankings, volumes or
-- competitor facts are ever inserted (unknown stays NULL/UNKNOWN honestly).
--
-- LOCK RISK: additive only (16 new tables + indexes; FKs reference only the
-- new tables). Safe online.

CREATE TABLE seo_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  business_type text NOT NULL DEFAULT 'UNRESOLVED',
  country text,
  uganda_relevance text NOT NULL DEFAULT 'UNKNOWN',
  local_presence boolean,
  product_overlap jsonb NOT NULL DEFAULT '[]'::jsonb,
  category_overlap jsonb NOT NULL DEFAULT '[]'::jsonb,
  b2b_relevant boolean,
  is_marketplace boolean NOT NULL DEFAULT false,
  is_brand boolean NOT NULL DEFAULT false,
  directness text NOT NULL DEFAULT 'UNRESOLVED',
  status text NOT NULL DEFAULT 'ACTIVE',
  merged_into_id uuid REFERENCES seo_competitors(id),
  evidence_source text,
  evidence_state text NOT NULL DEFAULT 'UNKNOWN',
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_competitors_business_type_chk CHECK (business_type IN ('MARKETPLACE','CLASSIFIED_MARKETPLACE','REGIONAL_MARKETPLACE','CROSS_BORDER_MARKETPLACE','LOCAL_ECOMMERCE','OMNICHANNEL_RETAILER','SPECIALIST_ACCESSORY_RETAILER','PHONE_RETAILER','COMPUTER_RETAILER','TELECOM_RETAILER','DIRECT_BRAND','B2B_CORPORATE_SUPPLIER','MANUFACTURER_BENCHMARK','SOCIAL_COMMERCE','INFORMATIONAL_SERP_COMPETITOR','UNRESOLVED')),
  CONSTRAINT seo_competitors_relevance_chk CHECK (uganda_relevance IN ('HIGH','MEDIUM','LOW','UNKNOWN')),
  CONSTRAINT seo_competitors_directness_chk CHECK (directness IN ('DIRECT','ADJACENT','SERP_ONLY','UNRESOLVED')),
  CONSTRAINT seo_competitors_status_chk CHECK (status IN ('ACTIVE','CANDIDATE','IGNORED','MERGED')),
  CONSTRAINT seo_competitors_evidence_state_chk CHECK (evidence_state IN ('OBSERVED','VERIFIED','MANAGEMENT_SUPPLIED','INFERRED','UNKNOWN'))
);
CREATE UNIQUE INDEX seo_competitors_canonical_name_idx ON seo_competitors (canonical_name);
CREATE INDEX seo_competitors_status_idx ON seo_competitors (status);

CREATE TABLE seo_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  normalized_query text NOT NULL,
  intent text NOT NULL DEFAULT 'UNKNOWN',
  funnel_stage text,
  category text,
  subcategory text,
  product_type text,
  brand text,
  model text,
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_path text,
  country text NOT NULL DEFAULT 'UG',
  city text,
  device text NOT NULL DEFAULT 'ALL',
  language text NOT NULL DEFAULT 'en',
  source text NOT NULL,
  volume integer,
  volume_source text,
  cpc_usd numeric,
  difficulty numeric,
  difficulty_methodology text,
  priority text NOT NULL DEFAULT 'UNTRIAGED',
  commercial_value text NOT NULL DEFAULT 'UNKNOWN',
  readiness text NOT NULL DEFAULT 'UNKNOWN',
  evidence_state text NOT NULL DEFAULT 'UNKNOWN',
  last_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_queries_intent_chk CHECK (intent IN ('COMMERCIAL','INFORMATIONAL','NAVIGATIONAL','LOCAL','TRANSACTIONAL','COMPARISON','UNKNOWN')),
  CONSTRAINT seo_queries_device_chk CHECK (device IN ('MOBILE','DESKTOP','ALL')),
  CONSTRAINT seo_queries_source_chk CHECK (source IN ('GSC','SITE_SEARCH','CATALOGUE','OPERATOR','SERP_OBSERVATION','CSV_IMPORT','CUSTOMER_SERVICE')),
  CONSTRAINT seo_queries_priority_chk CHECK (priority IN ('P0','P1','P2','P3','UNTRIAGED')),
  CONSTRAINT seo_queries_commercial_value_chk CHECK (commercial_value IN ('HIGH','MEDIUM','LOW','UNKNOWN')),
  CONSTRAINT seo_queries_readiness_chk CHECK (readiness IN ('READY','GATED','BLOCKED','UNKNOWN')),
  CONSTRAINT seo_queries_evidence_state_chk CHECK (evidence_state IN ('OBSERVED','VERIFIED','MANAGEMENT_SUPPLIED','INFERRED','UNKNOWN'))
);
CREATE UNIQUE INDEX seo_queries_normalized_query_idx ON seo_queries (normalized_query);
CREATE INDEX seo_queries_priority_idx ON seo_queries (priority);
CREATE INDEX seo_queries_category_idx ON seo_queries (category);

CREATE TABLE seo_serp_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id uuid NOT NULL REFERENCES seo_queries(id),
  engine text NOT NULL DEFAULT 'GOOGLE',
  provider text NOT NULL,
  country text NOT NULL DEFAULT 'UG',
  city text,
  device text NOT NULL DEFAULT 'MOBILE',
  language text NOT NULL DEFAULT 'en',
  observed_at timestamptz NOT NULL DEFAULT now(),
  rank integer,
  url text,
  domain text,
  title text,
  result_type text NOT NULL DEFAULT 'ORGANIC',
  serp_features jsonb NOT NULL DEFAULT '[]'::jsonb,
  competitor_id uuid REFERENCES seo_competitors(id),
  raw_provider_id text,
  evidence_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_serp_obs_engine_chk CHECK (engine IN ('GOOGLE','BING','OTHER')),
  CONSTRAINT seo_serp_obs_device_chk CHECK (device IN ('MOBILE','DESKTOP','ALL')),
  CONSTRAINT seo_serp_obs_result_type_chk CHECK (result_type IN ('ORGANIC','SHOPPING','FREE_LISTING','LOCAL_PACK','MAPS','IMAGE','VIDEO','PAA','FEATURED_SNIPPET','FORUM','KNOWLEDGE_PANEL','AI_OVERVIEW','RELATED','OTHER'))
);
CREATE INDEX seo_serp_obs_query_observed_idx ON seo_serp_observations (query_id, observed_at DESC);
CREATE INDEX seo_serp_obs_domain_idx ON seo_serp_observations (domain);

CREATE TABLE seo_gap_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id uuid NOT NULL REFERENCES seo_queries(id),
  our_position integer,
  our_url text,
  leader_competitor_id uuid REFERENCES seo_competitors(id),
  leader_position integer,
  leader_url text,
  leader_page_type text,
  observed_gaps jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence text NOT NULL DEFAULT 'LOW',
  action text,
  owner text,
  experiment_id uuid,
  result text,
  status text NOT NULL DEFAULT 'OPEN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_gap_confidence_chk CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  CONSTRAINT seo_gap_status_chk CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','REJECTED'))
);
CREATE INDEX seo_gap_records_query_idx ON seo_gap_records (query_id);
CREATE INDEX seo_gap_records_status_idx ON seo_gap_records (status);

CREATE TABLE seo_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL,
  query_id uuid REFERENCES seo_queries(id),
  url text,
  opportunity_value text NOT NULL DEFAULT 'UNKNOWN',
  evidence_confidence text NOT NULL DEFAULT 'LOW',
  commercial_readiness text NOT NULL DEFAULT 'UNKNOWN',
  technical_readiness text NOT NULL DEFAULT 'UNKNOWN',
  effort text NOT NULL DEFAULT 'M',
  risk text NOT NULL DEFAULT 'LOW',
  status text NOT NULL DEFAULT 'OPEN',
  source text NOT NULL,
  evidence jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_opps_kind_chk CHECK (kind IN ('HIGH_IMPRESSION_LOW_CTR','POSITION_2_5','POSITION_5_10','STRIKING_DISTANCE_11_20','RISING_QUERY','DECLINING_QUERY','NEW_QUERY','CANNIBALISATION','MISSING_CATEGORY','MISSING_PRODUCT','ATTRIBUTE_GAP','INTERNAL_LINK_GAP','STRUCTURED_DATA','MERCHANT_GAP','LOCAL_GAP','BACKLINK_GAP','CONTENT_DECAY','SERP_FEATURE')),
  CONSTRAINT seo_opps_value_chk CHECK (opportunity_value IN ('HIGH','MEDIUM','LOW','UNKNOWN')),
  CONSTRAINT seo_opps_evidence_confidence_chk CHECK (evidence_confidence IN ('HIGH','MEDIUM','LOW')),
  CONSTRAINT seo_opps_commercial_readiness_chk CHECK (commercial_readiness IN ('READY','GATED','BLOCKED','UNKNOWN')),
  CONSTRAINT seo_opps_technical_readiness_chk CHECK (technical_readiness IN ('READY','GATED','BLOCKED','UNKNOWN')),
  CONSTRAINT seo_opps_effort_chk CHECK (effort IN ('S','M','L','XL')),
  CONSTRAINT seo_opps_risk_chk CHECK (risk IN ('LOW','MEDIUM','HIGH')),
  CONSTRAINT seo_opps_status_chk CHECK (status IN ('OPEN','PLANNED','DONE','DISMISSED'))
);
CREATE INDEX seo_opportunities_status_idx ON seo_opportunities (status);
CREATE INDEX seo_opportunities_kind_idx ON seo_opportunities (kind);

CREATE TABLE seo_change_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  scope text NOT NULL,
  target text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  reason text NOT NULL,
  experiment_id uuid,
  deployment_ref text,
  validation_state text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_change_scope_chk CHECK (scope IN ('URL','TEMPLATE','ROBOTS','SITEMAP','REDIRECT','SCHEMA','CONTENT','METADATA','NAVIGATION','SETTINGS','OTHER')),
  CONSTRAINT seo_change_validation_chk CHECK (validation_state IN ('PENDING','VALIDATED','ROLLED_BACK','FAILED'))
);
CREATE INDEX seo_change_ledger_occurred_idx ON seo_change_ledger (occurred_at DESC);

CREATE TABLE seo_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'READY_FOR_CREDENTIALS',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  sync_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_integrations_provider_chk CHECK (provider IN ('GSC','GA4','MERCHANT_CENTER','GBP','KEYWORD_PROVIDER','RANK_TRACKER','BACKLINK_PROVIDER','BING_WEBMASTER','INDEXNOW','PAGESPEED','CRUX')),
  CONSTRAINT seo_integrations_status_chk CHECK (status IN ('READY_FOR_CREDENTIALS','CONNECTED','ERROR','DISABLED'))
);
CREATE UNIQUE INDEX seo_integrations_provider_idx ON seo_integrations (provider);

CREATE TABLE seo_crawl_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'RUNNING',
  scope text NOT NULL,
  page_limit integer NOT NULL,
  pages_crawled integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_crawl_runs_status_chk CHECK (status IN ('RUNNING','COMPLETE','FAILED','CANCELLED'))
);

CREATE TABLE seo_crawl_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES seo_crawl_runs(id) ON DELETE CASCADE,
  url text NOT NULL,
  final_url text NOT NULL,
  http_status integer NOT NULL,
  redirect_chain jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_type text,
  canonical text,
  meta_robots text,
  title text,
  meta_description text,
  h1 text,
  headings jsonb,
  word_count integer,
  images_missing_alt integer,
  internal_links jsonb,
  structured_data_types jsonb,
  issues jsonb,
  response_ms integer,
  content_hash text,
  crawled_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seo_crawl_pages_run_idx ON seo_crawl_pages (run_id);
CREATE INDEX seo_crawl_pages_url_idx ON seo_crawl_pages (url);

CREATE TABLE seo_link_graph (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_path text NOT NULL,
  to_path text NOT NULL,
  anchor text,
  rel text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- COALESCE on anchor so (from, to, NULL) cannot duplicate.
CREATE UNIQUE INDEX seo_link_graph_edge_idx ON seo_link_graph (from_path, to_path, COALESCE(anchor, ''));
CREATE INDEX seo_link_graph_to_path_idx ON seo_link_graph (to_path);

CREATE TABLE seo_aeo_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt text NOT NULL,
  engine text NOT NULL,
  category text,
  intent text,
  status text NOT NULL DEFAULT 'PLANNED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_aeo_prompts_engine_chk CHECK (engine IN ('CHATGPT','GEMINI','PERPLEXITY','CLAUDE','COPILOT','OTHER')),
  CONSTRAINT seo_aeo_prompts_status_chk CHECK (status IN ('PLANNED','QUEUED','EXECUTED','FAILED','NOT_TESTED','UNAVAILABLE'))
);

CREATE TABLE seo_aeo_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id uuid NOT NULL REFERENCES seo_aeo_prompts(id),
  engine text NOT NULL,
  model_version text,
  executed_at timestamptz NOT NULL DEFAULT now(),
  response_excerpt text,
  we_mentioned boolean NOT NULL,
  we_cited boolean NOT NULL,
  citation_url text,
  competitors_mentioned jsonb NOT NULL DEFAULT '[]'::jsonb,
  competitors_cited jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_aeo_obs_engine_chk CHECK (engine IN ('CHATGPT','GEMINI','PERPLEXITY','CLAUDE','COPILOT','OTHER'))
);
CREATE INDEX seo_aeo_observations_prompt_idx ON seo_aeo_observations (prompt_id, executed_at DESC);

CREATE TABLE seo_serp_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  classification text NOT NULL DEFAULT 'UNREVIEWED',
  competitor_id uuid REFERENCES seo_competitors(id),
  occurrences integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_serp_domains_classification_chk CHECK (classification IN ('KNOWN_COMPETITOR','NEW_COMMERCIAL','MANUFACTURER','PUBLISHER','FORUM','VIDEO','SOCIAL','MARKETPLACE','LOCAL_LISTING','OTHER','UNREVIEWED'))
);
CREATE UNIQUE INDEX seo_serp_domains_domain_idx ON seo_serp_domains (domain);

CREATE TABLE seo_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL,
  kind text NOT NULL,
  message text NOT NULL,
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_alerts_severity_chk CHECK (severity IN ('CRITICAL','HIGH','INFO')),
  CONSTRAINT seo_alerts_status_chk CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED'))
);
CREATE UNIQUE INDEX seo_alerts_open_dedupe_idx ON seo_alerts (dedupe_key) WHERE status = 'OPEN';

CREATE TABLE seo_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  hypothesis text NOT NULL,
  cohort text,
  start_at timestamptz,
  end_at timestamptz,
  change text NOT NULL,
  baseline jsonb,
  metric text NOT NULL,
  result text,
  confidence text,
  decision text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_experiments_decision_chk CHECK (decision IN ('PENDING','ADOPT','REVERT','INCONCLUSIVE'))
);

CREATE TABLE seo_keyword_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  country text NOT NULL DEFAULT 'UG',
  language text NOT NULL DEFAULT 'en',
  methodology text,
  row_count integer NOT NULL DEFAULT 0,
  imported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
