-- Loyalty hardening: make the ledger immutable at the database level.
--
-- FINDING
-- loyalty_ledger_entries has strong shape, type, idempotency and reversal
-- constraints, and appends are correctly serialised by a per-account advisory
-- transaction lock with an in-transaction balance check. But nothing prevents an
-- UPDATE or DELETE against a row once written.
--
-- RISK
-- Balances and the entire liability position are derived by summing this table.
-- A single UPDATE silently rewrites financial history, and because correction is
-- supposed to happen by appending a compensating entry, a mutation leaves no
-- trace in the ledger itself. That is a financial-control failure, not a bug:
-- reconciliation, liability ageing and breakage forecasting all become
-- unfalsifiable. It is reachable from a buggy migration, an ORM misuse, an
-- operational "quick fix", or any compromised path holding the app's role.
--
-- ROOT CAUSE
-- Append-only was a convention enforced only by application code. The database
-- accepted any mutation.
--
-- CHANGE
-- A BEFORE UPDATE OR DELETE trigger rejects every mutation. Corrections must be
-- made the way the domain already models them — by appending a `reversal`,
-- `expiry` or `adjustment` entry that references the original.
--
-- The trigger is deliberately absolute. A carve-out is what such controls always
-- lose: the moment one exception exists, "is this row original?" stops having an
-- answer. Genuine schema evolution disables the trigger explicitly inside a
-- reviewed migration, which is visible in the migration diff.
--
-- Additive and idempotent: no data is read, written, moved or discarded.
-- Rollback: DROP TRIGGER loyalty_ledger_entries_immutable ON loyalty_ledger_entries;

CREATE OR REPLACE FUNCTION loyalty_ledger_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'loyalty_ledger_entries is append-only: % on entry % is rejected. Append a reversal, expiry or adjustment entry that references it instead.',
    TG_OP,
    COALESCE(OLD.id::text, '(unknown)')
    USING ERRCODE = 'restrict_violation',
          HINT = 'Financial history is immutable so that balances, liability ageing and reconciliation stay falsifiable.';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS loyalty_ledger_entries_immutable ON loyalty_ledger_entries;
--> statement-breakpoint
CREATE TRIGGER loyalty_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON loyalty_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION loyalty_ledger_reject_mutation();
