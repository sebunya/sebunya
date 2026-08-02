-- Post-PR §3 — durable GTM plan persistence.
--
-- WHY
-- DrizzleGtmPlanRepository held planned (dry-run) GTM changes in a process-local
-- in-memory Map because no table existed — a forbidden in-memory correctness
-- map: plans vanished on restart and differed between instances. This table
-- makes the plan/diff durable, multi-instance-consistent and auditable. GTM
-- publication remains DISABLED; this stores intent + a checksum only, never a
-- credential and never a live change.
--
-- LOCK RISK: additive (one new table). Safe online.

CREATE TABLE measurement_gtm_plans (
  id varchar(64) PRIMARY KEY,               -- caller-supplied plan id (plan_<ts>)
  plan jsonb,
  diff jsonb,
  plan_checksum varchar(64),                -- sha256 of the plan JSON, for audit/dedupe
  status varchar(32) NOT NULL DEFAULT 'DRY_RUN',
  version integer NOT NULL DEFAULT 1,        -- optimistic concurrency
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

-- listRecentPlans orders by most recent.
CREATE INDEX measurement_gtm_plans_created_idx ON measurement_gtm_plans (created_at DESC);
