-- 0205 (2026-10-23): the shop's own copy of GA4's daily series.
-- The GA4 BigQuery export lives in a sandbox project whose tables expire after 60 days, and nothing in the
-- shop needs event-level rows. What the marketing mix model and the channel report can use is the daily
-- aggregate: sessions, users and purchases per Kampala day by channel group, source/medium, landing page and
-- device. The nightly pulls those from the GA4 Data API (service account, read-only) into this table, so the
-- history outlives Google's retention and never depends on BigQuery billing. One row per day, report and
-- dimension value; the last three days are re-pulled every night because GA4 fills in for up to 48 hours.
-- Rollback: DROP TABLE IF EXISTS measurement.ga4_daily_series;
CREATE TABLE IF NOT EXISTS measurement.ga4_daily_series (
  day date NOT NULL,
  report varchar(24) NOT NULL CHECK (report IN ('channel','source_medium','landing_page','device')),
  dimension varchar(200) NOT NULL,
  sessions integer NOT NULL DEFAULT 0,
  total_users integer NOT NULL DEFAULT 0,
  new_users integer NOT NULL DEFAULT 0,
  engaged_sessions integer NOT NULL DEFAULT 0,
  key_events integer NOT NULL DEFAULT 0,
  purchases integer NOT NULL DEFAULT 0,
  purchase_revenue_minor bigint NOT NULL DEFAULT 0,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (day, report, dimension)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ga4_daily_series_report_day_idx ON measurement.ga4_daily_series (report, day);
