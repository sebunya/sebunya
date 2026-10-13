-- ═══════════════════════════════════════════════════════════════════════════
-- 0180 — Indexes and table settings for Goldie's new workload (2026-10-13)
--
-- Every index below serves a query Goldie, the Care Desk or the conversation
-- inbox runs on a hot path, written to match the query's exact expression so
-- the planner can use it (the queries were adjusted in the same change):
--
--   orders: last nine digits of customer_phone — WhatsApp "my orders" matched the
--     number with right(regexp_replace(...), 9) and scanned EVERY order on every
--     WhatsApp message. Checkout stores the number as typed, hence the expression.
--   users: the same expression, verified phones only — the WhatsApp points lookup.
--   zero_party_signals: Goldie's past topics, per browser and per account, newest
--     first (the query reads each side with its own index and merges).
--   assistant_messages: trigram search over what customers and staff wrote (the
--     inbox search was ILIKE '%...%' over every message); the newest customer line
--     per conversation (the inbox list); Goldie's answers by time with their route
--     (the route mix on Teach Goldie and the meeting summary).
--   assistant_conversations: trigram search over name, phone and email; the
--     follow-up list (needs a person / with the team) by recency.
--   outbox_events: the per-address daily cap on chat copies.
--   care_tasks: the open queue (urgent first, oldest first), open-task dedupe per
--     conversation, and the recently-done list; the generic 0178 index is replaced.
--   support_issues: had only a primary key; every Goldie handover now opens one.
--     The inbox order, a customer's own tickets, and lookup by email.
--
-- Table settings: conversations, tasks and remembered answers are updated far more
-- than they are inserted (counters, outcome, last message), so they leave room on
-- each page for HOT updates and are vacuumed and analysed sooner; messages are
-- append-only and analysed sooner so plans follow their growth.
--
-- Not CONCURRENTLY (the migration runner is transactional, as in 0105): every table
-- here is small today, so each build is a brief lock. lock_timeout makes a build
-- give up rather than queue behind a long transaction; the migration then re-runs.
--
-- Additive and reversible. Rollback: DROP INDEX IF EXISTS each name below;
-- ALTER TABLE ... RESET (fillfactor, autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
-- CREATE INDEX care_tasks_open_idx ON care_tasks (status, priority, created_at).
-- ═══════════════════════════════════════════════════════════════════════════
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '120s';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS orders_phone_last9_idx ON orders ((right(regexp_replace(customer_phone, '\D', '', 'g'), 9)));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS users_verified_phone_last9_idx ON users ((right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9))) WHERE phone_verified_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS zero_party_goldie_fp_idx ON zero_party_signals (fp_client_id, captured_at DESC) WHERE source_component = 'goldie_chat';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS zero_party_goldie_user_idx ON zero_party_signals (user_id, captured_at DESC) WHERE source_component = 'goldie_chat';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_messages_people_trgm_idx ON assistant_messages USING gin (content gin_trgm_ops) WHERE role IN ('customer', 'team');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_messages_customer_last_idx ON assistant_messages (conversation_id, created_at DESC) WHERE role = 'customer';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_messages_goldie_created_idx ON assistant_messages (created_at) INCLUDE (route) WHERE role = 'goldie';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_conversations_contact_trgm_idx ON assistant_conversations USING gin ((coalesce(contact_name, '') || ' ' || coalesce(contact_phone, '') || ' ' || coalesce(contact_email, '')) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_conversations_followup_idx ON assistant_conversations (last_message_at DESC) WHERE outcome IN ('needs_human', 'handed_over');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS outbox_events_goldie_transcript_cap_idx ON outbox_events ((lower(payload->>'recipient')), created_at) WHERE event_type = 'GOLDIE_TRANSCRIPT';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS care_tasks_open_queue_idx ON care_tasks (priority, created_at) WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS care_tasks_open_dedupe_idx ON care_tasks (conversation_id, kind) WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS care_tasks_resolved_idx ON care_tasks (resolved_at DESC) WHERE status <> 'open';
--> statement-breakpoint
DROP INDEX IF EXISTS care_tasks_open_idx;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_issues_created_idx ON support_issues (created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_issues_customer_idx ON support_issues (customer_id) WHERE customer_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS support_issues_email_idx ON support_issues ((lower(metadata->>'email')));
--> statement-breakpoint
ALTER TABLE assistant_conversations SET (fillfactor = 85, autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
--> statement-breakpoint
ALTER TABLE care_tasks SET (fillfactor = 85, autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
--> statement-breakpoint
ALTER TABLE assistant_answer_memory SET (fillfactor = 80, autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
--> statement-breakpoint
ALTER TABLE assistant_messages SET (autovacuum_analyze_scale_factor = 0.02);
