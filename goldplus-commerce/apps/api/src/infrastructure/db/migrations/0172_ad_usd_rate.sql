-- 0172: one shillings-per-US-dollar rate for every ad platform (2026-10-06).
--
-- Owner decision: ad platforms receive sale values in US dollars only, never
-- Uganda shillings; customers still see and pay in UGX. The rate is set once
-- on the Advertising page. Until it is set, events and offline sales are sent
-- WITHOUT an amount (they still count), never in shillings. Single row.
-- TikTok's per-destination ugxPerUsd (2026-10-02) is copied in as the
-- starting value if it was set.
CREATE TABLE IF NOT EXISTS ad_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  ugx_per_usd integer CHECK (ugx_per_usd IS NULL OR ugx_per_usd BETWEEN 100 and 999999),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
INSERT INTO ad_settings (id, ugx_per_usd)
SELECT true, NULLIF(regexp_replace(coalesce((SELECT config->>'ugxPerUsd' FROM ad_destinations WHERE platform = 'tiktok'), ''), '[^0-9]', '', 'g'), '')::integer
ON CONFLICT (id) DO NOTHING;
