CREATE INDEX IF NOT EXISTS "outbox_events_event_type_processed_next_attempt_idx" ON "outbox_events" ("event_type","is_processed","next_attempt_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_events_is_processed_idx" ON "outbox_events" ("is_processed");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbox_events_next_attempt_at_idx" ON "outbox_events" ("next_attempt_at");