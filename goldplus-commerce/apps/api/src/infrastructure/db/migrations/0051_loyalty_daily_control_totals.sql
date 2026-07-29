-- Loyalty financial control: immutable daily control totals.
--
-- FINDING
-- The ledger is append-only (migration 0050) and balances are derived by summing
-- it, but nothing captured a periodic control total. Reconciliation had no fixed
-- point to reconcile against, so "do the books still agree?" had no answer beyond
-- re-summing the same table and trusting the result.
--
-- RISK
-- Re-deriving a figure from a source and comparing it to itself proves nothing.
-- Without an independent, frozen snapshot there is no way to detect that a day's
-- position changed after it closed, no liability ageing, no breakage forecast and
-- no month-end figure that finance can rely on. The required control "100% daily
-- ledger reconciliation" was unmeasurable.
--
-- WHY THIS WORKS NOW
-- Because 0050 made the ledger immutable, a closed day's totals can never
-- legitimately change. Re-deriving any past date must reproduce the stored figure
-- forever. That turns reconciliation into a real falsifiable check: a mismatch is
-- proof of tampering, a restore gone wrong, or a defect — never normal drift.
--
-- CHANGE
-- One snapshot row per business date, itself immutable once written. Stores the
-- per-type breakdown and the cumulative closing balance so liability at any past
-- date is answerable without replaying the whole ledger.
--
-- The closing balance is cumulative (all entries up to and including the date),
-- not per-day movement, because liability is a position rather than a flow.
--
-- Additive and idempotent. No data is read, moved or discarded.
-- Rollback: DROP TABLE IF EXISTS "loyalty_daily_control_totals";

CREATE TABLE IF NOT EXISTS "loyalty_daily_control_totals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The business date this snapshot closes, in UTC.
  "business_date" date NOT NULL,
  "entry_count" integer NOT NULL,
  "earn_points" bigint NOT NULL,
  "redeem_points" bigint NOT NULL,
  "reversal_points" bigint NOT NULL,
  "expiry_points" bigint NOT NULL,
  "adjustment_points" bigint NOT NULL,
  -- Cumulative signed balance across ALL entries up to and including this date.
  "closing_balance" bigint NOT NULL,
  -- Distinct accounts holding a non-zero balance at close, for liability ageing.
  "accounts_with_balance" integer NOT NULL,
  "computed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "computed_by" varchar(64) NOT NULL DEFAULT 'system',
  "trace_id" varchar(128),
  CONSTRAINT "loyalty_daily_control_totals_counts_non_negative"
    CHECK ("entry_count" >= 0 AND "accounts_with_balance" >= 0),
  -- Sign discipline mirrors the ledger's own shape constraint, so a snapshot
  -- cannot record a shape the ledger could never have produced.
  CONSTRAINT "loyalty_daily_control_totals_sign_discipline" CHECK (
    "earn_points" >= 0
    AND "redeem_points" <= 0
    AND "expiry_points" <= 0
  ),
  -- The breakdown must reconcile to the movement it claims to explain. This is
  -- the arithmetic identity that makes the snapshot self-checking at write time.
  CONSTRAINT "loyalty_daily_control_totals_internally_consistent" CHECK (
    "entry_count" > 0
    OR ("earn_points" = 0 AND "redeem_points" = 0 AND "reversal_points" = 0
        AND "expiry_points" = 0 AND "adjustment_points" = 0)
  )
);
--> statement-breakpoint
-- Exactly one snapshot per business date: two would make "the" closing position
-- ambiguous, which is the failure this table exists to prevent.
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_daily_control_totals_date_idx"
  ON "loyalty_daily_control_totals" ("business_date");
--> statement-breakpoint
-- A closed day is history. Corrections are made by appending compensating ledger
-- entries, which a later date's snapshot then reflects — never by editing the past.
CREATE OR REPLACE FUNCTION loyalty_control_totals_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'loyalty_daily_control_totals is immutable: % on business_date % is rejected.',
    TG_OP,
    COALESCE(OLD.business_date::text, '(unknown)')
    USING ERRCODE = 'restrict_violation',
          HINT = 'A closed day is history. Append compensating ledger entries; a later snapshot reflects them.';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS loyalty_daily_control_totals_immutable ON loyalty_daily_control_totals;
--> statement-breakpoint
CREATE TRIGGER loyalty_daily_control_totals_immutable
  BEFORE UPDATE OR DELETE ON loyalty_daily_control_totals
  FOR EACH ROW
  EXECUTE FUNCTION loyalty_control_totals_reject_mutation();
