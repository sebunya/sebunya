-- 0199: customers buy gift cards online for someone else (self-service, 2026-10-21).
--
-- WHAT
-- gift_card_purchases: one row per online purchase. It is paid through Pesapal under its own merchant reference
-- (GC-…), never as an order: a gift card is not goods, so nothing here may reach fulfilment, stock, delivery,
-- loyalty or revenue reporting. Once Pesapal confirms the money, the card is issued (a credit_instruments row,
-- 0196) and its code texted in the SAME transaction that marks the purchase issued, so a paid purchase can never
-- end with a card nobody was told about, or a code texted twice. A purchase may be scheduled for a later date
-- (a birthday): the card is issued and texted on that morning.
--
-- The code itself is never stored here; it exists only in the outbox row until the SMS is handled (0197 scrub).
--
-- Additive: a new table only. Rollback: drop it (nothing refers to it; the cards it issued stay valid).

CREATE TABLE IF NOT EXISTS "gift_card_purchases" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reference" varchar(20) NOT NULL,
  "amount_ugx" bigint NOT NULL,
  "buyer_name" varchar(120) NOT NULL,
  "buyer_phone" varchar(20) NOT NULL,
  "buyer_email" varchar(255),
  "buyer_user_id" uuid,
  "from_name" varchar(60) NOT NULL,
  "recipient_name" varchar(120) NOT NULL,
  "recipient_phone" varchar(20),
  "send_to" varchar(10) NOT NULL,
  "message" varchar(160),
  "deliver_on" date,
  "status" varchar(20) DEFAULT 'awaiting_payment' NOT NULL,
  "order_tracking_id" varchar(255),
  "redirect_url" text,
  "provider_status" text,
  "confirmation_code" varchar(120),
  "payment_method" varchar(60),
  "instrument_id" uuid REFERENCES "credit_instruments"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "paid_at" timestamp with time zone,
  "issued_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gift_card_purchases_reference_uq" UNIQUE ("reference"),
  CONSTRAINT "gift_card_purchases_amount_chk" CHECK ("amount_ugx" BETWEEN 10000 AND 500000),
  CONSTRAINT "gift_card_purchases_send_to_chk" CHECK ("send_to" in ('recipient','buyer')),
  CONSTRAINT "gift_card_purchases_recipient_phone_chk" CHECK ("send_to" = 'buyer' OR "recipient_phone" IS NOT NULL),
  CONSTRAINT "gift_card_purchases_status_chk" CHECK ("status" in ('awaiting_payment','paid','issued','failed','abandoned','review','refunded')),
  CONSTRAINT "gift_card_purchases_issued_chk" CHECK (("status" = 'issued') = ("instrument_id" IS NOT NULL) OR "status" = 'refunded')
);

CREATE UNIQUE INDEX IF NOT EXISTS "gift_card_purchases_tracking_uq" ON "gift_card_purchases" ("order_tracking_id") WHERE "order_tracking_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "gift_card_purchases_status_idx" ON "gift_card_purchases" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "gift_card_purchases_buyer_phone_idx" ON "gift_card_purchases" ("buyer_phone", "created_at");
CREATE INDEX IF NOT EXISTS "gift_card_purchases_buyer_user_idx" ON "gift_card_purchases" ("buyer_user_id");
