-- 0198: the gift card / store credit ledger is append-only in the database, not only by convention in the code.
--
-- A card's balance is the sum of its ledger, so rewriting or deleting a row silently changes money. The one change
-- the application makes is a hold moving held -> captured or held -> released (with settled_at). Everything else is
-- refused. Cards themselves cannot be deleted, and their code hash, value, kind and issuer cannot change.
-- A deliberate maintenance switch (SET LOCAL goldplus.credit_maintenance = 'on') exists for test clean-up and a
-- lawful erasure; it is not a security boundary (whoever can set it can drop the trigger) but it stops application
-- code and a mistyped query from rewriting money by accident.
CREATE OR REPLACE FUNCTION credit_ledger_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('goldplus.credit_maintenance', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'credit_ledger is append-only: rows cannot be deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.instrument_id IS DISTINCT FROM OLD.instrument_id OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.amount_ugx IS DISTINCT FROM OLD.amount_ugx OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'credit_ledger is append-only: only a hold''s state may change' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.hold_state IS DISTINCT FROM OLD.hold_state
     AND NOT (OLD.type = 'HOLD' AND OLD.hold_state = 'held' AND NEW.hold_state IN ('captured', 'released')) THEN
    RAISE EXCEPTION 'credit_ledger: a hold moves only from held to captured or released' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS credit_ledger_guard ON credit_ledger;
CREATE TRIGGER credit_ledger_guard BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_guard();

CREATE OR REPLACE FUNCTION credit_instrument_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('goldplus.credit_maintenance', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'credit_instruments cannot be deleted; cancel the card instead' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.code_hash IS DISTINCT FROM OLD.code_hash OR NEW.initial_value_ugx IS DISTINCT FROM OLD.initial_value_ugx
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.issued_by IS DISTINCT FROM OLD.issued_by THEN
    RAISE EXCEPTION 'credit_instruments: code, value, kind and issuer are fixed at issue' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS credit_instrument_guard ON credit_instruments;
CREATE TRIGGER credit_instrument_guard BEFORE UPDATE OR DELETE ON credit_instruments
  FOR EACH ROW EXECUTE FUNCTION credit_instrument_guard();
