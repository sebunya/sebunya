-- Outcomes (2026-11-03): the telemetry outbox stores the event as a JSON string inside jsonb, so the 0215
-- index matched nothing. Same predicate as the readers, on the unwrapped payload.
-- Rollback: DROP INDEX IF EXISTS outbox_events_begin_checkout_v2_idx; (0215's index may be recreated from its file)
DROP INDEX IF EXISTS outbox_events_begin_checkout_idx;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outbox_events_begin_checkout_v2_idx ON outbox_events (created_at)
  WHERE event_type = 'TELEMETRY_DISPATCH'
    AND ((case when jsonb_typeof(payload) = 'string' then (payload #>> '{}')::jsonb else payload end) ->> 'event_name') = 'begin_checkout';
