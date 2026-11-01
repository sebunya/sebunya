-- 0206 (2026-10-24): paid placements bought from an outlet, not from an ad platform.
-- The shop buys slots on top YouTube channels (a dedicated video, an integration, a mention, a short) and pays
-- the channel or its agency; later the same ledger takes radio and TV spots. Each row is one placement: who ran
-- it, what it was, when it went out, what it cost and over how many days that cost is spread for the model
-- (flight_days; the adstock in the model carries the effect further). Each placement gets a link slug for the
-- video description (utm_source=youtube&utm_medium=sponsorship&utm_campaign=<slug>), so arrivals land on the
-- YouTube channel row the spend sits on. Rows are ended (deleted_at), never deleted, so a reported cost can be
-- explained later.
-- media_placement_views: cumulative public view count per video per day from the YouTube Data API (nightly, API
-- key), the exposure series for the model; one row per day a reading was taken.
-- Rollback: DROP TABLE IF EXISTS media_placement_views; DROP TABLE IF EXISTS media_placements;
CREATE TABLE IF NOT EXISTS media_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  medium varchar(16) NOT NULL CHECK (medium IN ('youtube','radio','tv','billboard','podcast','press')),
  outlet varchar(120) NOT NULL,
  outlet_url varchar(300),
  title varchar(160) NOT NULL,
  placement_type varchar(24) NOT NULL CHECK (placement_type IN ('dedicated','integration','mention','short','live','spot','feature')),
  video_id varchar(32),
  publish_date date NOT NULL,
  flight_days integer NOT NULL DEFAULT 7 CHECK (flight_days BETWEEN 1 AND 90),
  cost_ugx bigint NOT NULL CHECK (cost_ugx > 0),
  payee varchar(120),
  promo_code varchar(40),
  link_slug varchar(60) NOT NULL UNIQUE,
  expected_views integer,
  expected_orders integer,
  audience_ug_share numeric(4,3) CHECK (audience_ug_share > 0 AND audience_ug_share <= 1),
  note varchar(300),
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  deleted_by uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS media_placements_publish_idx ON media_placements (publish_date) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS media_placement_views (
  placement_id uuid NOT NULL REFERENCES media_placements(id),
  day date NOT NULL,
  views bigint NOT NULL CHECK (views >= 0),
  likes integer,
  comments integer,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (placement_id, day)
);
