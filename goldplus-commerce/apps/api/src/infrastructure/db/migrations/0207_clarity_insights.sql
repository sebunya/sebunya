-- 0207 (2026-10-25): the shop's own copy of Microsoft Clarity's dashboard numbers, server to server.
-- Clarity's recordings and heatmaps live in Clarity and only exist because the tag runs in the shopper's browser.
-- What the shop keeps is the daily aggregate its Data Export API hands out (GET
-- www.clarity.ms/export-data/api/v1/project-live-insights, bearer token, 10 calls a project a day, last 1-3 days
-- only, UTC): traffic, scroll depth, engagement time, dead/rage/error clicks, quickbacks, script errors, popular
-- pages, browsers, devices, countries, referrers; in total, by URL and by channel. The nightly spends three of
-- the ten calls. One row per window day, breakdown, breakdown value, metric and field, so the history outlives
-- Clarity's three-day export window and sits beside the GA4 series for the same days.
-- Rollback: DROP TABLE IF EXISTS measurement.clarity_insights;
CREATE TABLE IF NOT EXISTS measurement.clarity_insights (
  day date NOT NULL,
  breakdown varchar(16) NOT NULL CHECK (breakdown IN ('total','URL','Channel')),
  breakdown_value varchar(300) NOT NULL,
  metric varchar(40) NOT NULL,
  field varchar(48) NOT NULL,
  value numeric(18,4) NOT NULL,
  fetched_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (day, breakdown, breakdown_value, metric, field)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS clarity_insights_day_metric_idx ON measurement.clarity_insights (day, metric);
