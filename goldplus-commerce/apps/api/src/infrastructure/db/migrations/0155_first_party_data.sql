-- 0155: first-party data (docs/first-party/README.md).
--
-- Six additive pieces, nothing dropped, nothing rewritten:
--   1. customer_identity_conflicts — one row per identifier that two canonical
--      customers claim, for a person to resolve (never an automatic merge on a
--      weak key). customer_profiles gains merged_into / merged_at so a guest
--      profile proven to be an account holder (verified phone) is FOLDED, not
--      deleted.
--   2. analysis.* — a reversible exclusion of our own monitor / cookieless SSR
--      exhaust from analysis: per-row marks, the runs that wrote them, and two
--      filtered views that reports read. Source rows are never updated or
--      deleted; reverting a run sets reverted_at on its marks.
--   3. customer_segments / _members / _runs — rule-based segments defined in
--      admin, materialised nightly.
--   4. WhatsApp marketing consent — a DISTINCT purpose (whatsapp_marketing) on
--      the existing whatsapp channel, seeded into the consent registry with its
--      copy version; a CHECK that only a signed-in (verified account) identity
--      can hold a grant; and consent_event_evidence for what was shown and
--      from where it was given. Off by default: no row = not opted in.
--   5. phone_normalisation_log — every format change the phone-hygiene script
--      applies, with the previous value, so each one is reversible.
--
-- Rollback: DROP VIEW analysis.recommendation_events_human,
--   analysis.experience_profiles_human; DROP TABLE analysis.traffic_exclusion_marks,
--   analysis.traffic_exclusion_runs; DROP SCHEMA analysis; DROP TABLE
--   customer_segment_members, customer_segment_runs, customer_segments,
--   customer_identity_conflicts, consent_event_evidence, phone_normalisation_log;
--   ALTER TABLE customer_profiles DROP COLUMN merged_into, DROP COLUMN merged_at;
--   ALTER TABLE customer_consent_states DROP CONSTRAINT
--   customer_consent_states_whatsapp_marketing_verified_chk; DELETE the three
--   whatsapp_marketing registry rows.

-- 1. Identity conflicts + guest-profile merge marker ------------------------
CREATE TABLE IF NOT EXISTS "customer_identity_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid,
	"signal_type" varchar(40) NOT NULL,
	"identifier_key" varchar(128) NOT NULL,
	"existing_canonical_id" uuid NOT NULL,
	"proposed_canonical_id" uuid NOT NULL,
	"moment" varchar(24),
	"occurrences" integer DEFAULT 1 NOT NULL,
	"status" varchar(16) DEFAULT 'OPEN' NOT NULL,
	"resolution" varchar(32),
	"resolved_by" varchar(80),
	"resolution_reason" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_identity_conflicts_open_uq"
	ON "customer_identity_conflicts" ("signal_type", "identifier_key", "existing_canonical_id", "proposed_canonical_id")
	WHERE "status" = 'OPEN';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_identity_conflicts_status_idx" ON "customer_identity_conflicts" ("status", "last_seen_at");
--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "merged_into" uuid;
--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD COLUMN IF NOT EXISTS "merged_at" timestamp with time zone;
--> statement-breakpoint

-- 2. Historical exhaust: reversible analysis exclusion ----------------------
CREATE SCHEMA IF NOT EXISTS "analysis";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analysis"."traffic_exclusion_runs" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"mode" varchar(12) NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"window_from" timestamp with time zone,
	"window_to" timestamp with time zone,
	"marked" integer DEFAULT 0 NOT NULL,
	"reverted" integer DEFAULT 0 NOT NULL,
	"actor" varchar(80) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analysis"."traffic_exclusion_marks" (
	"source_table" varchar(40) NOT NULL,
	"row_id" uuid NOT NULL,
	"rule_key" varchar(40) NOT NULL,
	"run_id" uuid NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverted_at" timestamp with time zone,
	"reverted_run_id" uuid,
	PRIMARY KEY ("source_table", "row_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_exclusion_marks_run_idx" ON "analysis"."traffic_exclusion_marks" ("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "traffic_exclusion_marks_active_rule_idx" ON "analysis"."traffic_exclusion_marks" ("source_table", "rule_key") WHERE "reverted_at" IS NULL;
--> statement-breakpoint
CREATE OR REPLACE VIEW "analysis"."recommendation_events_human" AS
	SELECT e.* FROM "public"."recommendation_events" e
	WHERE NOT EXISTS (
		SELECT 1 FROM "analysis"."traffic_exclusion_marks" m
		WHERE m.source_table = 'recommendation_events' AND m.row_id = e.id AND m.reverted_at IS NULL
	);
--> statement-breakpoint
CREATE OR REPLACE VIEW "analysis"."experience_profiles_human" AS
	SELECT p.* FROM "public"."experience_profiles" p
	WHERE NOT EXISTS (
		SELECT 1 FROM "analysis"."traffic_exclusion_marks" m
		WHERE m.source_table = 'experience_profiles' AND m.row_id = p.id AND m.reverted_at IS NULL
	);
--> statement-breakpoint

-- 3. Customer segments ------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customer_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text,
	"definition" jsonb NOT NULL,
	"definition_version" integer DEFAULT 1 NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"member_count" integer,
	"last_materialised_at" timestamp with time zone,
	"last_run_id" uuid,
	"created_by" varchar(80) NOT NULL,
	"updated_by" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_segments_key_unique" UNIQUE ("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_segment_members" (
	"segment_id" uuid NOT NULL REFERENCES "customer_segments" ("id"),
	"canonical_customer_id" uuid NOT NULL,
	"first_matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_id" uuid NOT NULL,
	PRIMARY KEY ("segment_id", "canonical_customer_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_segment_members_customer_idx" ON "customer_segment_members" ("canonical_customer_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_segment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" varchar(24) NOT NULL,
	"status" varchar(16) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"customers_evaluated" integer,
	"segments_evaluated" integer,
	"orders_stitched" integer,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_segment_runs_started_idx" ON "customer_segment_runs" ("started_at");
--> statement-breakpoint

-- 4. WhatsApp marketing consent --------------------------------------------
INSERT INTO "consent_purposes" ("purpose_key", "policy_version", "classification", "owner", "effective_at")
	VALUES ('whatsapp_marketing', 'v1', 'optional_marketing', 'GoldPlus owner', now())
	ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- content_hash = sha256 of WHATSAPP_MARKETING_COPY (domain/consent/WhatsAppMarketingConsent.ts);
-- a unit test pins the two together.
INSERT INTO "consent_copy_versions" ("copy_version_id", "purpose_key", "channel_key", "locale", "content_hash", "policy_version", "effective_at")
	VALUES ('whatsapp-marketing-v1', 'whatsapp_marketing', 'whatsapp', 'en-UG', 'efe502a4ac9ab7a7ae9bf671d002604babe503bd27fefedc8db66ecde14fd860', 'v1', now())
	ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "consent_source_surfaces" ("source_surface", "policy_version", "actor_class", "verification_floor", "authority_class", "effective_at")
	VALUES ('account_preference_centre_whatsapp', 'v1', 'customer', 'verified_account', 'customer_self_service', now())
	ON CONFLICT DO NOTHING;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "customer_consent_states" ADD CONSTRAINT "customer_consent_states_whatsapp_marketing_verified_chk"
		CHECK ("state" <> 'granted' OR "purpose_key" <> 'whatsapp_marketing' OR "identity_verification_level" NOT IN ('anonymous', 'checkout_contact_only'));
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_event_evidence" (
	"consent_event_id" uuid PRIMARY KEY NOT NULL,
	"purpose_key" varchar(100) NOT NULL,
	"channel_key" varchar(50) NOT NULL,
	"endpoint_hash" varchar(64),
	"endpoint_masked" varchar(32),
	"copy_version_id" varchar(100) NOT NULL,
	"copy_text_hash" varchar(64) NOT NULL,
	"confirmation" varchar(40) NOT NULL,
	"ip_hash" varchar(64),
	"user_agent_hash" varchar(64),
	"source_surface" varchar(100) NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 5. Phone hygiene log -------------------------------------------------------
CREATE TABLE IF NOT EXISTS "phone_normalisation_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"table_name" varchar(40) NOT NULL,
	"column_name" varchar(40) NOT NULL,
	"row_id" uuid NOT NULL,
	"previous_value" varchar(50) NOT NULL,
	"new_value" varchar(20) NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phone_normalisation_log_run_idx" ON "phone_normalisation_log" ("run_id");
