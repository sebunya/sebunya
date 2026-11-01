-- Technical SEO governance (0120): robots.txt versioning with approval and
-- rollback, Core Web Vitals measurements, raw-vs-rendered diffs, the SEO work
-- queue, and verified crawler hits from server logs.
--
-- WHY
-- Each table exists so a claim has somewhere honest to live:
--  * robots.txt is a live production control. Editing it from an admin screen
--    without versions, a diff and a rollback is how a site accidentally
--    deindexes itself. Exactly one version is published at a time.
--  * Core Web Vitals are MEASURED, never scored by us. Lab (PageSpeed) and
--    field (CrUX) are stored separately because they answer different
--    questions and must never be averaged together. A URL with no row has
--    NOT_MEASURED vitals — not "good".
--  * A raw-vs-rendered diff records what a crawler sees before JavaScript
--    versus after. NULL rendered_* means rendering was not attempted, which is
--    not the same as "no difference".
--  * The work queue closes observation -> gap -> opportunity -> work item ->
--    change -> validation -> outcome. Without it "opportunity" is a list
--    nobody owns.
--  * Crawler hits come from real server logs and carry a verification state,
--    because a Googlebot user-agent string is trivially forged.
--
-- LOCK RISK: additive only (5 new tables + indexes). Safe online.

-- ── robots.txt governance ───────────────────────────────────────────────────

CREATE TABLE seo_robots_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL,
  content text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  note text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  published_at timestamptz,
  superseded_at timestamptz,
  -- The version this one was rolled back to / restored from, when applicable.
  restored_from_id uuid REFERENCES seo_robots_versions(id),
  CONSTRAINT seo_robots_versions_status_chk CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','PUBLISHED','SUPERSEDED','REJECTED')),
  -- Approval is a recorded act, not a flag.
  CONSTRAINT seo_robots_versions_approved_chk CHECK (status NOT IN ('APPROVED','PUBLISHED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX seo_robots_versions_version_idx ON seo_robots_versions (version);
-- At most one live robots.txt. The storefront reads exactly this row.
CREATE UNIQUE INDEX seo_robots_versions_published_idx ON seo_robots_versions ((status = 'PUBLISHED')) WHERE status = 'PUBLISHED';

-- ── Core Web Vitals ─────────────────────────────────────────────────────────

CREATE TABLE seo_web_vitals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  source text NOT NULL,
  form_factor text NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  collection_date date NOT NULL,
  lcp_ms numeric,
  inp_ms numeric,
  cls numeric,
  ttfb_ms numeric,
  fcp_ms numeric,
  performance_score numeric,
  -- CrUX reports a distribution, not one number; keep the raw buckets.
  distributions jsonb,
  sample_size integer,
  connection_id uuid,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- LAB (PageSpeed, one synthetic run) and FIELD (CrUX, real users) answer
  -- different questions and are never mixed.
  CONSTRAINT seo_web_vitals_source_chk CHECK (source IN ('PAGESPEED_LAB','CRUX_FIELD')),
  CONSTRAINT seo_web_vitals_form_factor_chk CHECK (form_factor IN ('MOBILE','DESKTOP','ALL')),
  -- A performance score is only meaningful for a lab run; field data has none.
  CONSTRAINT seo_web_vitals_score_chk CHECK (performance_score IS NULL OR source = 'PAGESPEED_LAB')
);
CREATE UNIQUE INDEX seo_web_vitals_measurement_idx ON seo_web_vitals (url, source, form_factor, collection_date);
CREATE INDEX seo_web_vitals_url_idx ON seo_web_vitals (url, collected_at DESC);

-- ── Raw vs rendered ─────────────────────────────────────────────────────────

CREATE TABLE seo_render_diffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  -- Whether rendering was attempted at all. NOT_ATTEMPTED is honest; it is
  -- never reported as "no difference found".
  render_state text NOT NULL DEFAULT 'NOT_ATTEMPTED',
  raw_status integer,
  raw_title text,
  raw_meta_description text,
  raw_h1 text,
  raw_word_count integer,
  raw_link_count integer,
  raw_canonical text,
  raw_meta_robots text,
  raw_jsonld_count integer,
  rendered_title text,
  rendered_meta_description text,
  rendered_h1 text,
  rendered_word_count integer,
  rendered_link_count integer,
  rendered_canonical text,
  rendered_meta_robots text,
  rendered_jsonld_count integer,
  -- Field-level differences found, plus the severity an operator should act on.
  differences jsonb NOT NULL DEFAULT '[]'::jsonb,
  severity text NOT NULL DEFAULT 'NONE',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_render_diffs_render_state_chk CHECK (render_state IN ('NOT_ATTEMPTED','RENDERED','RENDER_FAILED','FETCH_FAILED')),
  CONSTRAINT seo_render_diffs_severity_chk CHECK (severity IN ('NONE','INFO','WARNING','CRITICAL','UNKNOWN')),
  -- No rendering means no verdict: severity must stay UNKNOWN.
  CONSTRAINT seo_render_diffs_verdict_chk CHECK (render_state = 'RENDERED' OR severity = 'UNKNOWN')
);
CREATE INDEX seo_render_diffs_url_idx ON seo_render_diffs (url, observed_at DESC);
CREATE INDEX seo_render_diffs_severity_idx ON seo_render_diffs (severity, observed_at DESC);

-- ── SEO work queue ──────────────────────────────────────────────────────────

CREATE TABLE seo_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  detail text,
  state text NOT NULL DEFAULT 'BACKLOG',
  priority text NOT NULL DEFAULT 'MEDIUM',
  -- The evidence chain this item came from. All optional individually, but a
  -- work item with no linkage at all is an idea, not evidence-driven work.
  opportunity_id uuid,
  gap_id uuid,
  observation_id uuid,
  change_ledger_id uuid,
  target_url text,
  assignee_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  -- The measured result after the change settled. NULL = not yet validated,
  -- which is never displayed as success.
  outcome text,
  outcome_note text,
  outcome_measured_at timestamptz,
  CONSTRAINT seo_work_items_state_chk CHECK (state IN ('BACKLOG','READY','IN_PROGRESS','BLOCKED','SHIPPED','VALIDATING','DONE','ABANDONED')),
  CONSTRAINT seo_work_items_priority_chk CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  CONSTRAINT seo_work_items_outcome_chk CHECK (outcome IS NULL OR outcome IN ('IMPROVED','NO_CHANGE','REGRESSED','INCONCLUSIVE','NOT_MEASURED')),
  -- DONE requires a measured outcome: work is not finished because someone
  -- shipped it, but because the result was checked.
  CONSTRAINT seo_work_items_done_chk CHECK (state <> 'DONE' OR outcome IS NOT NULL)
);
CREATE INDEX seo_work_items_state_idx ON seo_work_items (state, priority, created_at DESC);
CREATE INDEX seo_work_items_opportunity_idx ON seo_work_items (opportunity_id);

-- ── Server-log crawler hits ─────────────────────────────────────────────────

CREATE TABLE seo_crawler_hits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hit_at timestamptz NOT NULL,
  hit_date date NOT NULL,
  path text NOT NULL,
  crawler text NOT NULL,
  -- A Googlebot user-agent is trivially forged, so the claim is separated from
  -- its verification. UNVERIFIED means we did not (or could not) check.
  verification text NOT NULL DEFAULT 'UNVERIFIED',
  status_code integer,
  bytes integer,
  response_ms integer,
  user_agent text,
  source_file text,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_crawler_hits_verification_chk CHECK (verification IN ('VERIFIED','SPOOFED','UNVERIFIED','NOT_CHECKED'))
);
CREATE INDEX seo_crawler_hits_date_idx ON seo_crawler_hits (hit_date DESC, crawler);
CREATE INDEX seo_crawler_hits_path_idx ON seo_crawler_hits (path, hit_date DESC);
CREATE INDEX seo_crawler_hits_verification_idx ON seo_crawler_hits (verification, hit_date DESC);

-- Ingestion runs, so a report can say what window the data actually covers.
CREATE TABLE seo_log_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL,
  format text NOT NULL,
  lines_read integer NOT NULL DEFAULT 0,
  lines_parsed integer NOT NULL DEFAULT 0,
  lines_rejected integer NOT NULL DEFAULT 0,
  crawler_hits integer NOT NULL DEFAULT 0,
  window_start timestamptz,
  window_end timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seo_log_ingestions_created_idx ON seo_log_ingestions (created_at DESC);
