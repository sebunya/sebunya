-- Outcomes page (2026-11-03): checkout starts are counted from the telemetry outbox per window.
-- Rollback: DROP INDEX IF EXISTS outbox_events_begin_checkout_idx;
CREATE INDEX IF NOT EXISTS outbox_events_begin_checkout_idx ON outbox_events (created_at)
  WHERE event_type = 'TELEMETRY_DISPATCH' AND (payload->>'event_name') = 'begin_checkout';
