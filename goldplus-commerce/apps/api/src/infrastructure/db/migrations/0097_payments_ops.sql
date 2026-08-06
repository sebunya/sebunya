-- ═══════════════════════════════════════════════════════════════════════════
-- 0097 — Payments operational configuration
--
-- One key-value row per setting, every key validated against the closed
-- registry in code (PaymentsOpsConfig.ts) before it can be written. The table
-- ships EMPTY: every mechanism it governs — reservation TTL, order
-- abandonment, the payment-health alert — is OFF until an operator sets a
-- number. No developer-invented defaults.
--
-- ADDITIVE AND REVERSIBLE. ZERO INSERTS, like 0092 through 0096.
--
-- Rollback: DROP TABLE payments_ops_config;
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "payments_ops_config" (
  "config_key" varchar(64) PRIMARY KEY NOT NULL,
  "config_value" text NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
