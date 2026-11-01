-- 0166 — Click-to-WhatsApp ad referrals (2026-10-01).
--
-- When someone taps a Click-to-WhatsApp advert and sends the shop a message,
-- the WhatsApp Business Platform's webhook delivers a `referral` with the ad
-- and Meta's click id (ctwa_clid). Reporting a later sale to Meta against
-- that click id is the only way a WhatsApp advert is credited with it. This
-- table keeps that click id until the sale.
--
-- What is NOT kept: the message, the sender's number, their name. The sender
-- is stored as the SHA-256 of their number in E.164 digits — the same hash a
-- sale already carries (ad_offline_sales.phone_digits_sha256, Meta's `ph`) —
-- which is all that is needed to find the referral for a sale.
--
-- Additive and idempotent. Rollback: drop the table; restore the three-value
-- capability check.
CREATE TABLE IF NOT EXISTS whatsapp_ad_referrals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id           text NOT NULL UNIQUE,
  waba_id              text NOT NULL,
  phone_number_id      text,
  sender_phone_sha256  char(64) NOT NULL,
  ctwa_clid            text NOT NULL,
  source_type          text,
  source_id            text,
  source_url           text,
  headline             text,
  received_at          timestamptz NOT NULL,
  recorded_at          timestamptz NOT NULL DEFAULT now(),
  attributed_count     integer NOT NULL DEFAULT 0,
  last_attributed_at   timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS whatsapp_ad_referrals_sender_idx ON whatsapp_ad_referrals (sender_phone_sha256, received_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS whatsapp_ad_referrals_received_idx ON whatsapp_ad_referrals (received_at DESC);
--> statement-breakpoint
-- The WhatsApp ads settings live with the other Meta capabilities.
ALTER TABLE ad_destination_capabilities DROP CONSTRAINT IF EXISTS ad_destination_capabilities_capability_check;
--> statement-breakpoint
ALTER TABLE ad_destination_capabilities ADD CONSTRAINT ad_destination_capabilities_capability_check CHECK (capability IN ('audiences', 'spend', 'offline', 'whatsapp_ads'));
