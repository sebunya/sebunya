DO $$ BEGIN
 CREATE TYPE "canonical_consent_state" AS ENUM('unknown', 'not_requested', 'requested_support_assisted', 'pending_verification', 'granted', 'withdrawn', 'expired', 'superseded', 'blocked_by_policy', 'service_only');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "consent_actor_type" AS ENUM('customer', 'support_operator', 'admin', 'provider_callback', 'system_policy', 'migration_dry_run', 'test_fixture');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "consent_identity_level" AS ENUM('anonymous', 'checkout_contact_only', 'support_verified_contact', 'verified_account', 'provider_callback_verified', 'admin_operator_confirmed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "consent_legacy_mapping_outcome" AS ENUM('unknown', 'requested_support_assisted', 'not_applicable');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "channel_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_identity_ref" varchar(255),
	"endpoint_ref" varchar(255) NOT NULL,
	"channel_key" varchar(50) NOT NULL,
	"purpose_key" varchar(100),
	"scope" varchar(50) NOT NULL,
	"reason" text NOT NULL,
	"source_surface" varchar(100) NOT NULL,
	"provider_callback_ref" varchar(255),
	"suppression_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_key" varchar(50) NOT NULL,
	"policy_version" varchar(50) NOT NULL,
	"verification_requirement" varchar(80) NOT NULL,
	"suppression_scope" varchar(50) NOT NULL,
	"owner" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_copy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"copy_version_id" varchar(100) NOT NULL,
	"purpose_key" varchar(100) NOT NULL,
	"channel_key" varchar(50) NOT NULL,
	"locale" varchar(20) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"policy_version" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"superseded_by" uuid,
	CONSTRAINT "consent_copy_versions_copy_version_id_unique" UNIQUE("copy_version_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_events" (
	"consent_event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"customer_identity_ref" varchar(255) NOT NULL,
	"endpoint_ref" varchar(255),
	"purpose_key" varchar(100) NOT NULL,
	"channel_key" varchar(50) NOT NULL,
	"state" "canonical_consent_state" NOT NULL,
	"source_surface" varchar(100) NOT NULL,
	"actor_type" "consent_actor_type" NOT NULL,
	"actor_id" varchar(255),
	"copy_version_id" varchar(100),
	"previous_state" "canonical_consent_state",
	"new_state" "canonical_consent_state" NOT NULL,
	"reason" text NOT NULL,
	"provider_callback_ref" varchar(255),
	"support_ticket_ref" varchar(255),
	"correlation_id" varchar(255) NOT NULL,
	"retention_policy" varchar(100) NOT NULL,
	"integrity_hash" varchar(64),
	"tamper_evidence_ref" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_policy_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_identity_ref" varchar(255),
	"cohort_ref" varchar(255),
	"purpose_key" varchar(100),
	"channel_key" varchar(50),
	"policy_block_reason" text NOT NULL,
	"policy_version" varchar(50) NOT NULL,
	"actor_type" "consent_actor_type" NOT NULL,
	"actor_id" varchar(255),
	"correlation_id" varchar(255) NOT NULL,
	"integrity_hash" varchar(64),
	"tamper_evidence_ref" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_purposes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose_key" varchar(100) NOT NULL,
	"policy_version" varchar(50) NOT NULL,
	"classification" varchar(50) NOT NULL,
	"owner" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_source_surfaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_surface" varchar(100) NOT NULL,
	"policy_version" varchar(50) NOT NULL,
	"actor_class" varchar(50) NOT NULL,
	"verification_floor" "consent_identity_level" NOT NULL,
	"authority_class" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_consent_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_identity_ref" varchar(255) NOT NULL,
	"endpoint_ref" varchar(255) NOT NULL,
	"purpose_key" varchar(100) NOT NULL,
	"channel_key" varchar(50) NOT NULL,
	"identity_verification_level" "consent_identity_level" NOT NULL,
	"state" "canonical_consent_state" DEFAULT 'unknown' NOT NULL,
	"source_surface" varchar(100) NOT NULL,
	"copy_version_id" varchar(100),
	"last_consent_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "legacy_preference_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mapping_version" varchar(50) NOT NULL,
	"legacy_system" varchar(100) NOT NULL,
	"legacy_field" varchar(100) NOT NULL,
	"legacy_value_class" varchar(100) NOT NULL,
	"target_purpose_key" varchar(100),
	"target_channel_key" varchar(50),
	"mapping_outcome" "consent_legacy_mapping_outcome" DEFAULT 'unknown' NOT NULL,
	"confidence" varchar(20) NOT NULL,
	"reason" text NOT NULL,
	"review_status" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_unsubscribe_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_key" varchar(100) NOT NULL,
	"provider_event_ref" varchar(255) NOT NULL,
	"provider_callback_ref" varchar(255) NOT NULL,
	"endpoint_ref" varchar(255) NOT NULL,
	"channel_key" varchar(50) NOT NULL,
	"purpose_key" varchar(100),
	"scope" varchar(50) NOT NULL,
	"authenticity_verified" boolean NOT NULL,
	"freshness_verified" boolean NOT NULL,
	"provider_occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" varchar(255) NOT NULL,
	"integrity_hash" varchar(64),
	"tamper_evidence_ref" varchar(255),
	"normalized_evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_assisted_preference_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_identity_ref" varchar(255) NOT NULL,
	"endpoint_ref" varchar(255),
	"purpose_key" varchar(100) NOT NULL,
	"channel_key" varchar(50) NOT NULL,
	"requested_state" "canonical_consent_state" NOT NULL,
	"identity_verification_level" "consent_identity_level" NOT NULL,
	"verification_status" varchar(50) NOT NULL,
	"support_ticket_ref" varchar(255) NOT NULL,
	"actor_type" "consent_actor_type" NOT NULL,
	"actor_id" varchar(255) NOT NULL,
	"script_copy_version_id" varchar(100) NOT NULL,
	"correlation_id" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_suppressions_active_idx" ON "channel_suppressions" ("endpoint_ref","channel_key","purpose_key","suppression_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channel_suppressions_provider_callback_idx" ON "channel_suppressions" ("provider_callback_ref");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consent_channels_key_version_uidx" ON "consent_channels" ("channel_key","policy_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_channels_active_idx" ON "consent_channels" ("channel_key","effective_at","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_copy_versions_purpose_channel_idx" ON "consent_copy_versions" ("purpose_key","channel_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_copy_versions_hash_idx" ON "consent_copy_versions" ("content_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_events_aggregate_audit_idx" ON "consent_events" ("customer_identity_ref","purpose_key","channel_key","effective_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_events_correlation_idx" ON "consent_events" ("correlation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_events_provider_callback_idx" ON "consent_events" ("provider_callback_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_policy_blocks_active_idx" ON "consent_policy_blocks" ("customer_identity_ref","purpose_key","channel_key","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_policy_blocks_cohort_idx" ON "consent_policy_blocks" ("cohort_ref","purpose_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consent_purposes_key_version_uidx" ON "consent_purposes" ("purpose_key","policy_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_purposes_active_idx" ON "consent_purposes" ("purpose_key","effective_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "consent_source_surfaces_source_version_uidx" ON "consent_source_surfaces" ("source_surface","policy_version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_source_surfaces_authority_idx" ON "consent_source_surfaces" ("authority_class","verification_floor");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_consent_states_aggregate_uidx" ON "customer_consent_states" ("customer_identity_ref","endpoint_ref","purpose_key","channel_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_consent_states_state_idx" ON "customer_consent_states" ("state","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_consent_states_identity_idx" ON "customer_consent_states" ("customer_identity_ref","purpose_key");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "legacy_preference_mappings_rule_uidx" ON "legacy_preference_mappings" ("mapping_version","legacy_system","legacy_field","legacy_value_class");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "legacy_preference_mappings_review_idx" ON "legacy_preference_mappings" ("review_status","mapping_outcome");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_unsubscribe_events_provider_event_uidx" ON "provider_unsubscribe_events" ("provider_key","provider_event_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_unsubscribe_events_suppression_idx" ON "provider_unsubscribe_events" ("endpoint_ref","channel_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_assisted_preference_requests_ticket_idx" ON "support_assisted_preference_requests" ("support_ticket_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_assisted_preference_requests_pending_idx" ON "support_assisted_preference_requests" ("customer_identity_ref","verification_status","expires_at");
--> statement-breakpoint
ALTER TABLE "customer_consent_states"
  ADD CONSTRAINT "customer_consent_states_no_anonymous_grant_chk"
  CHECK ("state" <> 'granted' OR "identity_verification_level" <> 'anonymous');
--> statement-breakpoint
ALTER TABLE "customer_consent_states"
  ADD CONSTRAINT "customer_consent_states_no_checkout_marketing_grant_chk"
  CHECK (
    "state" <> 'granted'
    OR "purpose_key" <> 'marketing_offers_campaigns'
    OR "identity_verification_level" <> 'checkout_contact_only'
  );
--> statement-breakpoint
ALTER TABLE "consent_events"
  ADD CONSTRAINT "consent_events_tamper_evidence_chk"
  CHECK ("integrity_hash" IS NOT NULL OR "tamper_evidence_ref" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "provider_unsubscribe_events"
  ADD CONSTRAINT "provider_unsubscribe_events_tamper_evidence_chk"
  CHECK ("integrity_hash" IS NOT NULL OR "tamper_evidence_ref" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "support_assisted_preference_requests"
  ADD CONSTRAINT "support_assisted_requests_no_direct_grant_chk"
  CHECK ("requested_state" <> 'granted');
--> statement-breakpoint
ALTER TABLE "consent_policy_blocks"
  ADD CONSTRAINT "consent_policy_blocks_scope_chk"
  CHECK ("customer_identity_ref" IS NOT NULL OR "cohort_ref" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "consent_policy_blocks"
  ADD CONSTRAINT "consent_policy_blocks_tamper_evidence_chk"
  CHECK ("integrity_hash" IS NOT NULL OR "tamper_evidence_ref" IS NOT NULL);
--> statement-breakpoint
CREATE FUNCTION "reject_consent_audit_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'consent audit records are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "consent_events_append_only"
BEFORE UPDATE OR DELETE ON "consent_events"
FOR EACH ROW EXECUTE FUNCTION "reject_consent_audit_mutation"();
--> statement-breakpoint
CREATE TRIGGER "provider_unsubscribe_events_append_only"
BEFORE UPDATE OR DELETE ON "provider_unsubscribe_events"
FOR EACH ROW EXECUTE FUNCTION "reject_consent_audit_mutation"();
--> statement-breakpoint
CREATE TRIGGER "consent_policy_blocks_append_only"
BEFORE UPDATE OR DELETE ON "consent_policy_blocks"
FOR EACH ROW EXECUTE FUNCTION "reject_consent_audit_mutation"();
