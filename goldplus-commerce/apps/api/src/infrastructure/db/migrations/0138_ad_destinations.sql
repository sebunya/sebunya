-- 0138 — Advertising destinations (server-side conversion APIs).
-- One row per platform: an on/off switch, the NON-secret ids (pixel/dataset/
-- account) and the access token encrypted with the integration vault
-- (write-only; only a mask is ever shown). Delivery runs through outbox_events
-- (event_type AD_CONVERSION, one row per platform per event) so each platform
-- retries on its own. No row = not configured.
CREATE TABLE IF NOT EXISTS ad_destinations (
  platform        varchar(32) PRIMARY KEY,
  enabled         boolean NOT NULL DEFAULT false,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_enc      text,
  secret_mask     varchar(40),
  updated_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  last_error      text,
  last_error_at   timestamptz,
  sent_count      bigint NOT NULL DEFAULT 0,
  failed_count    bigint NOT NULL DEFAULT 0
);
