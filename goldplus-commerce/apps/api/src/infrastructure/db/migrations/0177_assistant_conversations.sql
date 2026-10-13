-- 0177: Goldie conversation archive (owner, 2026-10-13: "save all customer conversations and
-- replies in the back end so we can follow and structure them for our meetings").
--
-- One row per conversation (any channel: web chat, WhatsApp), one row per message. The topic,
-- mood and outcome are filed per message and rolled up per conversation, so the admin inbox and
-- the meeting summary are plain queries. Card numbers, PINs and OTPs are redacted before a
-- message reaches this table (domain/assistant/ConversationRedaction). Kept 365 days, then
-- purged by the nightly job.
--
-- Additive and reversible. Rollback:
--   DROP TABLE IF EXISTS assistant_messages;
--   DROP TABLE IF EXISTS assistant_conversations;

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel varchar(20) NOT NULL,
  -- Web: the browser's conversation id; WhatsApp: sha256 of the number. Unique per channel.
  channel_key varchar(128) NOT NULL,
  customer_id uuid,
  contact_name varchar(120),
  contact_phone varchar(32),
  contact_email varchar(200),
  first_topic varchar(20),
  last_topic varchar(20),
  worst_mood varchar(12) DEFAULT 'neutral' NOT NULL,
  outcome varchar(20) DEFAULT 'open' NOT NULL,
  support_ticket_id uuid,
  page text,
  message_count integer DEFAULT 0 NOT NULL,
  ai_turns integer DEFAULT 0 NOT NULL,
  -- WhatsApp: a person from the shop has taken over; Goldie stays quiet until this time.
  human_until timestamptz,
  started_at timestamptz DEFAULT now() NOT NULL,
  last_message_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS assistant_conversations_channel_key_uq ON assistant_conversations (channel, channel_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_conversations_last_idx ON assistant_conversations (last_message_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_conversations_customer_idx ON assistant_conversations (customer_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role varchar(12) NOT NULL,
  content text NOT NULL,
  intent varchar(20),
  mood varchar(12),
  route varchar(16),
  -- The channel's own message id (WhatsApp wamid), so a redelivered webhook is filed once.
  channel_message_id varchar(160),
  created_at timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_messages_conversation_idx ON assistant_messages (conversation_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS assistant_messages_channel_message_uq ON assistant_messages (channel_message_id) WHERE channel_message_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS assistant_messages_created_idx ON assistant_messages (created_at);
