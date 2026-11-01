-- Loyalty ledger: an earn may be settled more than once (2026-09-24, owner
-- approved "fix loyalty FIFO expiry/clawback, migration allowed").
--
-- 0047 made "one reversal per entry" and "one expiry per earn" unique. Both
-- are now wrong:
--   * ClawbackOrderEarnUseCase claws a second partial refund with a NEW key
--     (reversal:<earn>:<running total>), and the unique index refused the
--     insert with a raw constraint error;
--   * points a refunded redemption returns to an already-expired earn must
--     expire again (terms: "original expiry dates intact"), which needs a
--     second expiry row on the same earn (key expiry:<earn>:<running total>).
--
-- Duplicates stay impossible: every ledger write is deduplicated by the
-- unique loyalty_ledger_idem_idx on idempotency_key, which is untouched. The
-- same-name indexes are recreated NON-unique so lookups by source keep their
-- plan. Additive for old code: it never writes a second row per source, and a
-- manual reversal after a clawback is refused in code (ALREADY_REVERSED).
-- Rollback: recreate the two indexes as UNIQUE (only possible while no source
-- has two rows).
DROP INDEX IF EXISTS "loyalty_ledger_reversal_source_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_ledger_reversal_source_idx"
  ON "loyalty_ledger_entries" ("reversed_entry_id")
  WHERE "type" = 'reversal';
--> statement-breakpoint
DROP INDEX IF EXISTS "loyalty_ledger_expiry_source_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_ledger_expiry_source_idx"
  ON "loyalty_ledger_entries" ("reversed_entry_id")
  WHERE "type" = 'expiry';
