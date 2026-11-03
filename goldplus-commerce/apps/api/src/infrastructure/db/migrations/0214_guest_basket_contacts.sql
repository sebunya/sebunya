-- Basket reminders for guests (owner decision 2026-11-03: market to every shopper, signed in or not).
-- A guest's number exists nowhere until they type it at checkout; this table keeps it against the guest
-- cart owner id (the signed cart credential's owner), so a basket left behind can be texted once.
CREATE TABLE IF NOT EXISTS "guest_basket_contacts" (
  "owner_id" varchar(128) PRIMARY KEY NOT NULL,
  "phone_e164" varchar(20) NOT NULL,
  "name" varchar(120),
  "captured_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "guest_basket_contacts_phone_idx" ON "guest_basket_contacts" ("phone_e164");
--> statement-breakpoint
-- The sweep reads guest baskets too: same partial shape as the signed-in index, by owner kind.
CREATE INDEX IF NOT EXISTS "cart_abandonments_guest_reminder_due_idx" ON "cart_abandonments" ("classified_at") WHERE status = 'OPEN' AND reminded_at IS NULL AND owner_kind = 'GUEST';
