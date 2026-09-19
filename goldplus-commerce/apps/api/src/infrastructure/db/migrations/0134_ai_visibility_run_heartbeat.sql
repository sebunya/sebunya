-- 0134 — AI Search: run liveness is judged by progress, not age.
-- A healthy run can legitimately take hours (questions are asked one after
-- another per provider, each call up to 3 x 90 s). Marking it FAILED by start
-- time let a live run keep spending while a second one started. Each finished
-- call now touches heartbeat_at; only a run with no progress for a while is
-- considered dead. Additive.
ALTER TABLE aiv_runs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;
