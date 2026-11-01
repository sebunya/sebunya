-- 0185: customer WhatsApp messages sent through Meta, kept 7 days (owner, 2026-10-14: enterprise WhatsApp).
--
--   whatsapp_sent_messages — the Meta message id (wamid) and what was sent (template, recipient, the same values),
--     so that when Meta's delivery receipt says FAILED (number not on WhatsApp, blocked, expired) the customer still
--     gets that update by SMS, once. Purged after 7 days by the api.
--
-- Additive. Rollback: DROP TABLE IF EXISTS whatsapp_sent_messages.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS whatsapp_sent_messages (
  message_id varchar(160) PRIMARY KEY,
  recipient varchar(40) NOT NULL,
  template varchar(100) NOT NULL,
  payload jsonb NOT NULL,
  sent_at timestamptz DEFAULT now() NOT NULL,
  sms_fallback_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS whatsapp_sent_messages_sent_at_idx ON whatsapp_sent_messages (sent_at);
