-- Audit log: append-only at the database level.
--
-- FINDING
-- `audit_logs` carried no constraint, trigger or grant restriction. The
-- application's database role could UPDATE or DELETE any row in it.
--
-- RISK
-- An audit log that the application can rewrite is not evidence of anything. The
-- account most likely to want a row gone is the one that produced it: whoever
-- compromises an admin session, or an insider acting outside their remit, can
-- perform the action and then erase the record of having performed it — using
-- the same connection, with no second system involved. Every downstream use of
-- this table (incident investigation, access review, dispute resolution) assumes
-- the history is complete, and nothing made that true.
--
-- This is the same defect migration 0050 fixed for the loyalty ledger. It is
-- worth stating that the loyalty fix does not help here: the ledger records
-- value, the audit log records WHO CHANGED WHAT, and it is the latter that
-- answers "was this authorised".
--
-- CHANGE
-- A BEFORE UPDATE OR DELETE trigger that raises. Inserts are untouched, so
-- nothing about how the application writes audit entries changes.
--
-- Corrections are made by appending a further entry describing the correction,
-- which is what an audit trail is for: the mistaken entry and its correction are
-- both part of the history.
--
-- Additive and idempotent. No data is read, moved or discarded.
-- Rollback:
--   DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
--   DROP FUNCTION IF EXISTS audit_logs_reject_mutation();

CREATE OR REPLACE FUNCTION audit_logs_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only: % on entry % is rejected. An audit trail the application can rewrite is not evidence.',
    TG_OP,
    COALESCE(OLD.id::text, '(unknown)')
    USING ERRCODE = 'restrict_violation',
          HINT = 'Append a further entry describing the correction. The mistaken entry and its correction are both part of the history.';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_reject_mutation();
--> statement-breakpoint
-- Investigation queries are "what did this actor do" and "what happened to this
-- entity", in time order. Without these both are sequential scans, which is why
-- an investigation under pressure tends to get abandoned.
CREATE INDEX IF NOT EXISTS "audit_logs_actor_time_idx"
  ON "audit_logs" ("actor_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_entity_time_idx"
  ON "audit_logs" ("entity", "entity_id", "created_at" DESC);
