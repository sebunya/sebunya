-- 0135 — AI Search: the four-eyes decision is recorded when a run is requested.
-- Reading the approval threshold at approval time let the requester raise it
-- and then approve their own run. The decision now travels with the run.
-- Additive; existing rows default to TRUE (the stricter reading).
ALTER TABLE aiv_runs ADD COLUMN IF NOT EXISTS over_threshold boolean NOT NULL DEFAULT true;
