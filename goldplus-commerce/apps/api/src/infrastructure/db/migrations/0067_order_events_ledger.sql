-- P0-2 §5 — canonical append-only order-transition ledger (order_events).
--
-- WHY
-- The OrderStateMachine governs legal transitions but no per-transition history
-- was recorded, so AC2 (illegal => zero events) and AC3 (each transition => one
-- event) could not be proven and lifecycle audit was absent. This table is the
-- single canonical order-history ledger, written in the SAME transaction as the
-- status update. Append-only: no application UPDATE/DELETE path; an architecture
-- test enforces it. No raw PII / provider payloads / tokens are stored.
--
-- LOCK RISK: additive (one new table + a backfill INSERT..SELECT bounded by the
-- current single-shop order count). Safe online.

CREATE TABLE order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  from_status varchar(30),                       -- null for creation/backfill
  to_status varchar(30) NOT NULL,
  actor_id uuid,                                 -- null for system/migration
  actor_type varchar(24) NOT NULL,
  reason_code varchar(48),
  source varchar(24) NOT NULL,
  note varchar(500),
  idempotency_key varchar(120),
  correlation_id varchar(120),
  is_synthetic boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_events_actor_type_chk CHECK (actor_type IN ('customer','administrator','system','payment_provider','fulfilment_worker','migration')),
  CONSTRAINT order_events_source_chk CHECK (source IN ('admin_api','payment','fulfilment','customer','system','migration'))
);

-- Bounded history reads by order, most-recent-first.
CREATE INDEX order_events_order_occurred_idx ON order_events (order_id, occurred_at);
-- Idempotency: at most one event per external transition identity. Partial so
-- many null keys are allowed.
CREATE UNIQUE INDEX order_events_idempotency_uq ON order_events (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Truthful legacy backfill: exactly one synthetic snapshot per pre-existing
-- order. from_status=null asserts "the order HELD this stored state when history
-- began", NOT that the transition to it was observed. NOT EXISTS makes it
-- idempotent (re-running adds no duplicates).
INSERT INTO order_events (order_id, from_status, to_status, actor_type, source, reason_code, is_synthetic, occurred_at)
SELECT o.id, NULL, o.status, 'migration', 'migration', 'legacy_state_snapshot_backfill', true, o.created_at
FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id);
