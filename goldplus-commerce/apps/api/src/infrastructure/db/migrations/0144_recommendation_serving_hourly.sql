-- Recommendation serving health (0144). "Is the engine serving, are placements
-- filled, how deep in the fallback ladder are we?" is an OPERATIONAL question.
-- It was answered by writing one RECOMMENDATION_RESPONSE row per rendered rail
-- into the customer-behaviour table — ~95% of its 878k rows, almost all minted
-- by our own monitor and cookieless SSR. This table holds the same answer in
-- one row per placement per hour: bounded, and never mistaken for behaviour.
--
-- Historical RESPONSE rows are NOT touched by this migration.
-- Rollback: DROP TABLE recommendation_serving_hourly;
CREATE TABLE IF NOT EXISTS "recommendation_serving_hourly" (
  "hour" timestamptz NOT NULL,
  "placement" text NOT NULL,
  "responses" integer NOT NULL DEFAULT 0,
  "empty" integer NOT NULL DEFAULT 0,
  "fallback_served" integer NOT NULL DEFAULT 0,
  "last_response_at" timestamptz NOT NULL,
  PRIMARY KEY ("hour", "placement")
);
