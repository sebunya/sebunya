-- 0181: Care operations for an enterprise-grade Goldie (owner, 2026-10-13: "fix all of these").
--
--   care_tasks.escalations / last_escalated_at — an urgent task nobody has taken pages the team again
--     (at most twice, 15 minutes apart).
--   care_task_notes — internal notes on a task (who did what), shown on the desk.
--   care_saved_replies — the team's ready answers, for replies from the inbox (WhatsApp or email).
--   care_handover_notes — what the next shift needs to know, newest first on the desk.
--   assistant_qa_reviews — the weekly human quality review of a sample of Goldie's chats (score + note).
--   assistant_conversations.profile_id / visitor_key — the shopper's server profile and analytics id, so a chat
--     can be linked to the order that followed (revenue influenced by Goldie).
--   care_push_subscriptions — staff phones that receive Care Desk alerts as push notifications.
--
-- Additive and reversible. Rollback: DROP TABLE IF EXISTS care_task_notes, care_saved_replies, care_handover_notes,
-- assistant_qa_reviews, care_push_subscriptions; ALTER TABLE care_tasks DROP COLUMN IF EXISTS escalations,
-- DROP COLUMN IF EXISTS last_escalated_at; ALTER TABLE assistant_conversations DROP COLUMN IF EXISTS profile_id,
-- DROP COLUMN IF EXISTS visitor_key.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE care_tasks ADD COLUMN IF NOT EXISTS escalations integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE care_tasks ADD COLUMN IF NOT EXISTS last_escalated_at timestamptz;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS care_task_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES care_tasks(id) ON DELETE CASCADE,
  author_id uuid,
  note text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS care_task_notes_task_idx ON care_task_notes (task_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS care_saved_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(80) NOT NULL,
  body text NOT NULL,
  uses integer DEFAULT 0 NOT NULL,
  created_by uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS care_handover_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid,
  note text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS care_handover_notes_created_idx ON care_handover_notes (created_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_qa_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  week varchar(10) NOT NULL,
  score smallint,
  accurate boolean,
  tone_ok boolean,
  note text,
  reviewer_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS assistant_qa_reviews_conv_week_uq ON assistant_qa_reviews (conversation_id, week);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_qa_reviews_week_idx ON assistant_qa_reviews (week, reviewed_at);
--> statement-breakpoint
ALTER TABLE assistant_conversations ADD COLUMN IF NOT EXISTS profile_id uuid;
--> statement-breakpoint
ALTER TABLE assistant_conversations ADD COLUMN IF NOT EXISTS visitor_key varchar(200);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_conversations_profile_idx ON assistant_conversations (profile_id) WHERE profile_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS care_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh varchar(200) NOT NULL,
  auth varchar(100) NOT NULL,
  label varchar(80),
  created_at timestamptz DEFAULT now() NOT NULL,
  last_success_at timestamptz,
  failures integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS care_push_subscriptions_endpoint_uq ON care_push_subscriptions (endpoint);
