-- 0175: shop-assistant spend ledger and operator policy (AI customer-experience
-- mandate 2026-10-12, §5 "a REAL $5 monthly enforcement mechanism").
-- Additive and reversible: two new tables, no existing row touched.
-- No customer text is stored: the ledger holds amounts, tokens, model, a
-- one-way visitor pseudonym and an outcome category.
-- Rollback (comments only; roll the code back first):
--   DROP TABLE assistant_model_calls;
--   DROP TABLE assistant_config;

CREATE TABLE IF NOT EXISTS assistant_model_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month varchar(7) NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'RESERVED',
  reserved_micro_usd bigint NOT NULL,
  settled_micro_usd bigint,
  model varchar(60) NOT NULL,
  provider_request_id varchar(120),
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  principal_hash varchar(64) NOT NULL,
  conversation_id varchar(64),
  outcome varchar(40),
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CONSTRAINT assistant_model_calls_status_check CHECK (status IN ('RESERVED', 'SETTLED', 'RELEASED', 'UNKNOWN'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_model_calls_month_status_idx ON assistant_model_calls (month, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_model_calls_created_idx ON assistant_model_calls (created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_config (
  id boolean PRIMARY KEY DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistant_config_single_row CHECK (id = true)
);
