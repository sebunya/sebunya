-- 0140 — Measurement core (dossier GP-EVT / GP-DLV), additive.
-- Immutable business events are appended INSIDE the commerce transaction that
-- caused them (OrderTransitionService.apply, DrizzleOrderRepository.savePricedOrder);
-- routing, delivery intents and attempts are mutable execution state beside them.
CREATE SCHEMA IF NOT EXISTS measurement;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS measurement.business_event (
  event_id uuid PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('development','test','staging','production')),
  business_dedupe_key text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  source_transition_id text NOT NULL,
  event_name text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  canonical_sha256 char(64) NOT NULL,
  trace_id text NOT NULL,
  UNIQUE (environment, business_dedupe_key),
  UNIQUE (event_id, environment)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS business_event_aggregate_idx ON measurement.business_event (aggregate_type, aggregate_id, occurred_at);
--> statement-breakpoint
-- Same business key replayed with DIFFERENT content: kept for investigation, never merged.
CREATE TABLE IF NOT EXISTS measurement.event_conflict (
  conflict_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL,
  business_dedupe_key text NOT NULL,
  original_event_id uuid NOT NULL REFERENCES measurement.business_event(event_id),
  attempted_sha256 char(64) NOT NULL,
  attempted_payload jsonb NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS measurement.event_routing (
  event_id uuid PRIMARY KEY REFERENCES measurement.business_event(event_id),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','LEASED','ROUTED','QUARANTINED')),
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  routed_at timestamptz,
  routing_policy_version text,
  last_error_code text,
  CHECK ((state = 'LEASED') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS event_routing_pending_idx ON measurement.event_routing (next_attempt_at, event_id) WHERE state IN ('PENDING','LEASED');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS measurement.delivery_intent (
  delivery_id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES measurement.business_event(event_id),
  sink_key text NOT NULL,
  environment text NOT NULL,
  provider_event_id text,
  state text NOT NULL CHECK (state IN ('PENDING','LEASED','RETRY_WAIT','ACCEPTED','PROCESSED','UNKNOWN_OUTCOME','SUPPRESSED','QUARANTINED','DEAD_LETTER','CANCELLED')),
  state_reason text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  enqueue_generation bigint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  next_enqueue_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE (event_id, sink_key),
  FOREIGN KEY (event_id, environment) REFERENCES measurement.business_event(event_id, environment),
  CHECK ((state = 'LEASED') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delivery_due_idx ON measurement.delivery_intent (next_attempt_at, delivery_id) WHERE state IN ('PENDING','RETRY_WAIT');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS delivery_expired_lease_idx ON measurement.delivery_intent (lease_until) WHERE state = 'LEASED';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS delivery_provider_identity_idx ON measurement.delivery_intent (environment, sink_key, provider_event_id) WHERE provider_event_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS measurement.delivery_attempt (
  attempt_id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES measurement.delivery_intent(delivery_id),
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  lease_token uuid NOT NULL,
  adapter_version text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  outcome text NOT NULL,
  http_status integer,
  provider_code text,
  retry_after_at timestamptz,
  safe_payload_sha256 char(64),
  safe_response jsonb,
  UNIQUE (delivery_id, attempt_no)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS measurement.commercial_entry (
  entry_id uuid PRIMARY KEY,
  environment text NOT NULL,
  order_ref text NOT NULL,
  line_ref text,
  source_system text NOT NULL,
  source_entry_key text NOT NULL,
  component text NOT NULL CHECK (component IN ('NET_MERCHANDISE','DELIVERY_REVENUE','COGS','COGS_RECOVERY','PAYMENT_FEE','DELIVERY_EXPENSE','REFUND','RETURN_EXPENSE','OTHER_VARIABLE')),
  amount_ugx bigint NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  economic_policy_version text NOT NULL,
  reverses_entry_id uuid REFERENCES measurement.commercial_entry(entry_id),
  event_id uuid NOT NULL REFERENCES measurement.business_event(event_id),
  UNIQUE (environment, source_system, source_entry_key)
);
--> statement-breakpoint
-- Kill switch and other measurement controls (one row per key).
CREATE TABLE IF NOT EXISTS measurement.control (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  reason text
);
--> statement-breakpoint
-- A measurement write that failed inside a commerce transaction (D-008): the
-- sale committed, the event did not; this row is the alarm and the repair list.
CREATE TABLE IF NOT EXISTS measurement.write_failure (
  failure_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  aggregate_id text NOT NULL,
  context text NOT NULL,
  error text NOT NULL,
  resolved_at timestamptz
);
