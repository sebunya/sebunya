-- 0193: location signals (2026-10-16). What customers TELL us about where they want delivery, kept server-side so it
-- works across pages and devices and so we can learn from it — under a stated purpose and a retention limit
-- (Uganda Data Protection and Privacy Act 2019: purpose, minimisation, retention).
--
-- 1. experience_profiles.deliver_*: the visitor's "Deliver to" area (area only: slug, district, label). A service
--    preference the customer set themselves; a signed-in customer's newest one follows them to other devices.
-- 2. location_signals: one row per meaningful location action — "Deliver to" set, a delivery fee shown for an area,
--    a "Locate me" offer chosen or missed. NO coordinates, NO IP, NO user agent: an area, a fee, a rank, a distance.
--    profile_id/customer_id are set only when the customer has granted personalisation; otherwise the row is
--    anonymous and feeds area-level statistics only. Rows are deleted after 395 days (nightly purge).
-- Additive; rollback: DROP TABLE location_signals; ALTER TABLE experience_profiles DROP COLUMN deliver_*.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE experience_profiles
  ADD COLUMN IF NOT EXISTS deliver_area_slug varchar(160),
  ADD COLUMN IF NOT EXISTS deliver_district varchar(60),
  ADD COLUMN IF NOT EXISTS deliver_label varchar(120),
  ADD COLUMN IF NOT EXISTS deliver_set_at timestamptz;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS location_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  kind varchar(30) NOT NULL,
  surface varchar(20) NOT NULL,
  profile_id uuid,
  customer_id uuid,
  area_slug varchar(160),
  district varchar(60),
  fee_ugx integer,
  quote_kind varchar(40),
  offer_rank smallint,
  offer_km numeric(7,2),
  personalisation boolean NOT NULL DEFAULT false,
  CONSTRAINT location_signals_kind_check CHECK (kind in ('deliver_to_set','quote_shown','locate_offer_chosen','locate_offer_missed')),
  CONSTRAINT location_signals_surface_check CHECK (surface in ('pdp','cart','checkout','account','home')),
  CONSTRAINT location_signals_rank_check CHECK (offer_rank is null or offer_rank between 1 and 10),
  CONSTRAINT location_signals_link_check CHECK (personalisation or (profile_id is null and customer_id is null))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS location_signals_area_time_idx ON location_signals (area_slug, occurred_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS location_signals_time_idx ON location_signals (occurred_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS location_signals_customer_idx ON location_signals (customer_id) WHERE customer_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS experience_profiles_deliver_customer_idx ON experience_profiles (customer_id, deliver_set_at) WHERE deliver_set_at IS NOT NULL;
