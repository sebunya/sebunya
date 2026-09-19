-- 0133 — AI Search: spend that is not an answer.
-- Provider Test calls cost money but are not answers, so they were invisible to
-- the spend limits. Every such cost is recorded here and counted with the
-- observations' costs. Additive; drop the table to revert.
CREATE TABLE IF NOT EXISTS aiv_spend_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES aiv_projects(id) ON DELETE CASCADE,
  provider text NOT NULL,
  kind text NOT NULL CONSTRAINT aiv_spend_ledger_kind_chk CHECK (kind IN ('PROVIDER_TEST')),
  cost_usd numeric(10,5) NOT NULL CHECK (cost_usd >= 0),
  basis text NOT NULL CONSTRAINT aiv_spend_ledger_basis_chk CHECK (basis IN ('PROVIDER_REPORTED','ESTIMATE_PER_CALL')),
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aiv_spend_ledger_project_time_idx ON aiv_spend_ledger (project_id, created_at);
