-- 0210 (2026-10-26): basket reminders (gap analysis #1). A signed-in shopper who leaves items in their basket
-- can be texted once about it, only if they asked for such texts: an unticked box at sign-up or in My
-- preferences, beside the exact words whose hash is pinned below (domain/consent/BasketReminderConsent.ts;
-- a unit test pins the two together). Its own consent purpose on the SMS channel, off by default, separate from
-- WhatsApp offers. The reminder itself is MARKETING in the outbound governance, so a recorded STOP outranks it.
-- Rollback: ALTER TABLE cart_abandonments DROP COLUMN reminded_at, DROP COLUMN reminder_outcome; DELETE the
-- three basket_reminders registry rows; the check constraint may stay.
ALTER TABLE cart_abandonments ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
--> statement-breakpoint
ALTER TABLE cart_abandonments ADD COLUMN IF NOT EXISTS reminder_outcome varchar(16);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cart_abandonments_reminder_due_idx ON cart_abandonments (classified_at) WHERE status = 'OPEN' AND reminded_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cart_abandonments_owner_reminded_idx ON cart_abandonments (owner_id, reminded_at) WHERE reminder_outcome = 'sent';
--> statement-breakpoint
INSERT INTO "consent_purposes" ("purpose_key", "policy_version", "classification", "owner", "effective_at")
	VALUES ('basket_reminders', 'v1', 'optional_marketing', 'GoldPlus owner', now())
	ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "consent_copy_versions" ("copy_version_id", "purpose_key", "channel_key", "locale", "content_hash", "policy_version", "effective_at")
	VALUES ('basket-reminders-v1', 'basket_reminders', 'sms', 'en-UG', 'a26af31a668cbc39528dc1861e11d81b3c2f94f4c134f97df0e00266b3ccb31c', 'v1', now())
	ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "consent_source_surfaces" ("source_surface", "policy_version", "actor_class", "verification_floor", "authority_class", "effective_at")
	VALUES ('registration_basket_reminders', 'v1', 'customer', 'verified_account', 'customer_self_service', now()),
	       ('account_preference_centre_basket_reminders', 'v1', 'customer', 'verified_account', 'customer_self_service', now())
	ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "customer_consent_states" ADD CONSTRAINT "customer_consent_states_basket_reminders_verified_chk"
		CHECK ("state" <> 'granted' OR "purpose_key" <> 'basket_reminders' OR "identity_verification_level" NOT IN ('anonymous', 'checkout_contact_only'));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
