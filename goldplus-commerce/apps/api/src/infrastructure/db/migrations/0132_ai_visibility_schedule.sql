-- 0132 — AI Search: recurring monitoring schedule per project.
-- Additive and idempotent (the CHECK rides on ADD COLUMN IF NOT EXISTS).
-- OFF by default: nothing runs, and nothing is spent, until a person turns it on.
ALTER TABLE aiv_projects ADD COLUMN IF NOT EXISTS monitor_schedule text NOT NULL DEFAULT 'OFF'
  CONSTRAINT aiv_projects_schedule_chk CHECK (monitor_schedule IN ('OFF','DAILY','WEEKLY'));
ALTER TABLE aiv_projects ADD COLUMN IF NOT EXISTS schedule_set_by uuid;
ALTER TABLE aiv_projects ADD COLUMN IF NOT EXISTS last_scheduled_at timestamptz;
