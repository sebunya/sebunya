-- 0118 — SEO Integrations Control Plane: provider registry, connections,
-- encrypted credential vault, sync jobs, integration audit and usage caps.
--
-- WHY
-- The Organic Growth OS (0116) knows integrations only as env-var presence on
-- the legacy seo_integrations table. This migration adds the authoritative
-- control plane: a provider manifest registry (with UI form schemas), operator
-- managed connections with an honest status lifecycle, an AES-256-GCM
-- credential vault (ciphertext + mask only — NEVER a plaintext column), a sync
-- job ledger (the Sync Operations Center feed), a dedicated integration audit
-- trail (no secret values ever), and per-provider daily usage counters that
-- enforce external-call caps. Quota limits live in providers.manifest.quota
-- with per-connection overrides in connections.config — no limit columns.
--
-- LOCK RISK: additive only (6 new tables + indexes; FKs reference only the new
-- tables). Safe online.

CREATE TABLE seo_integration_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  canonical_name text NOT NULL,
  family text NOT NULL,
  description text NOT NULL DEFAULT '',
  auth_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  supports jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_sync_frequency text,
  docs_url text,
  enabled boolean NOT NULL DEFAULT true,
  experimental boolean NOT NULL DEFAULT false,
  adapter_version text NOT NULL DEFAULT '1',
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_int_providers_family_chk CHECK (family IN (
    'GOOGLE_SEARCH','GOOGLE_ANALYTICS','GOOGLE_MERCHANT','GOOGLE_LOCAL',
    'GOOGLE_PERFORMANCE','MICROSOFT_SEARCH','INDEXING_PROTOCOL','SERP_PROVIDER',
    'KEYWORD_PROVIDER','BACKLINK_PROVIDER','AI_ENGINE','WEB_PERFORMANCE',
    'CUSTOM_READ_ONLY','OTHER'))
);
CREATE UNIQUE INDEX seo_int_providers_provider_id_idx ON seo_integration_providers (provider_id);

CREATE TABLE seo_integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL REFERENCES seo_integration_providers (provider_id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'NOT_CONFIGURED',
  account_ref text,
  property_ref text,
  -- NON-SECRET configuration only; secrets live exclusively in the vault table.
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  sync_frequency text,
  backfill_window_days integer,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  data_freshness_at timestamptz,
  quota_state jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_int_connections_status_chk CHECK (status IN (
    'NOT_CONFIGURED','CONFIGURING','AUTHORIZATION_REQUIRED','READY','CONNECTED',
    'SYNCING','HEALTHY','STALE','RATE_LIMITED','AUTH_EXPIRED','PERMISSION_ERROR',
    'PROVIDER_ERROR','DISABLED'))
);
CREATE INDEX seo_int_connections_provider_idx ON seo_integration_connections (provider_id);
CREATE INDEX seo_int_connections_status_idx ON seo_integration_connections (status);

CREATE TABLE seo_integration_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES seo_integration_connections (id) ON DELETE CASCADE,
  auth_type text NOT NULL,
  -- AES-256-GCM, base64 segments iv.tag.data. There is deliberately NO
  -- plaintext column and no reversible mask.
  ciphertext text NOT NULL,
  mask text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'ACTIVE',
  expires_at timestamptz,
  created_by uuid,
  last_rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seo_int_credentials_auth_type_chk CHECK (auth_type IN (
    'OAUTH2','SERVICE_ACCOUNT','API_KEY','BEARER_TOKEN','BASIC_AUTH','CUSTOM_HEADER','NONE')),
  CONSTRAINT seo_int_credentials_status_chk CHECK (status IN ('ACTIVE','ROTATED','REVOKED','EXPIRED'))
);
CREATE INDEX seo_int_credentials_connection_idx ON seo_integration_credentials (connection_id, status);

CREATE TABLE seo_integration_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES seo_integration_connections (id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  records_read integer NOT NULL DEFAULT 0,
  records_inserted integer NOT NULL DEFAULT 0,
  records_updated integer NOT NULL DEFAULT 0,
  records_rejected integer NOT NULL DEFAULT 0,
  cursor jsonb,
  error text,
  requested_by uuid,
  CONSTRAINT seo_int_sync_jobs_type_chk CHECK (job_type IN ('BACKFILL','INCREMENTAL','MANUAL','SCHEDULED','TEST')),
  CONSTRAINT seo_int_sync_jobs_status_chk CHECK (status IN ('QUEUED','RUNNING','COMPLETE','FAILED','CANCELLED'))
);
CREATE INDEX seo_int_sync_jobs_connection_idx ON seo_integration_sync_jobs (connection_id, requested_at);
CREATE INDEX seo_int_sync_jobs_status_idx ON seo_integration_sync_jobs (status);

CREATE TABLE seo_integration_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid,
  provider_id text,
  actor_id uuid,
  action text NOT NULL,
  -- Metadata only — secret values must never be written here.
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX seo_int_audit_occurred_idx ON seo_integration_audit (occurred_at);
CREATE INDEX seo_int_audit_connection_idx ON seo_integration_audit (connection_id);

CREATE TABLE seo_integration_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id text NOT NULL,
  day date NOT NULL,
  request_count integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX seo_int_usage_provider_day_idx ON seo_integration_usage (provider_id, day);
