CREATE TABLE IF NOT EXISTS "consent_current_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fp_client_id" varchar(255),
	"user_id" uuid,
	"analytics_granted" boolean DEFAULT false NOT NULL,
	"advertising_granted" boolean DEFAULT false NOT NULL,
	"personalization_granted" boolean DEFAULT false NOT NULL,
	"last_grant_type" varchar(30) DEFAULT 'unknown' NOT NULL,
	"last_notice_version" varchar(20) DEFAULT 'v1.0' NOT NULL,
	"last_consent_record_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "consent_current_state_fp_client_id_unique" UNIQUE("fp_client_id"),
	CONSTRAINT "consent_current_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fp_client_id" varchar(255),
	"user_id" uuid,
	"purposes" jsonb NOT NULL,
	"grant_type" varchar(30) NOT NULL,
	"capture_surface" varchar(50) NOT NULL,
	"notice_version" varchar(20) NOT NULL,
	"consent_language" varchar(10) NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"is_withdrawal" boolean DEFAULT false NOT NULL,
	"withdrawn_purposes" jsonb,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attribution_touchpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fp_client_id" varchar(255),
	"user_id" uuid,
	"order_id" uuid,
	"event_id" varchar(255) NOT NULL,
	"event_name" varchar(100) NOT NULL,
	"has_hashed_email" integer DEFAULT 0 NOT NULL,
	"has_hashed_phone" integer DEFAULT 0 NOT NULL,
	"has_fbp" integer DEFAULT 0 NOT NULL,
	"has_fbc" integer DEFAULT 0 NOT NULL,
	"has_gclid" integer DEFAULT 0 NOT NULL,
	"has_ttclid" integer DEFAULT 0 NOT NULL,
	"has_li_fat_id" integer DEFAULT 0 NOT NULL,
	"has_ip_address" integer DEFAULT 0 NOT NULL,
	"has_user_agent" integer DEFAULT 0 NOT NULL,
	"match_score" real DEFAULT 0 NOT NULL,
	"routed_destinations" jsonb,
	"blocked_destinations" jsonb,
	"event_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zero_party_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fp_client_id" varchar(255),
	"user_id" uuid,
	"session_id" varchar(255),
	"signal_type" varchar(50) NOT NULL,
	"payload" jsonb NOT NULL,
	"page_location" text,
	"product_id" varchar(255),
	"source_component" varchar(100),
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_admin_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"resource" varchar(100) NOT NULL,
	"action" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_admin_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "measurement_admin_roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_api_failures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_name" varchar(100) NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"status_code" integer,
	"error_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(100) NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"action" varchar(100) NOT NULL,
	"changes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_campaign_attribution" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fp_client_id" varchar(255),
	"user_id" uuid,
	"utm_source" varchar(255),
	"utm_medium" varchar(255),
	"utm_campaign" varchar(255),
	"utm_content" text,
	"utm_term" text,
	"gclid" varchar(255),
	"fbclid" varchar(255),
	"ttclid" varchar(255),
	"twclid" varchar(255),
	"li_fat_id" varchar(255),
	"pinterest_click_id" varchar(255),
	"snapchat_click_id" varchar(255),
	"referrer" text,
	"landing_page" text,
	"first_touch_timestamp" timestamp with time zone,
	"last_touch_timestamp" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_dashboard_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"metric_name" varchar(100) NOT NULL,
	"metric_value" real NOT NULL,
	"dimensions" jsonb,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_data_quality_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"event_id" varchar(255),
	"alert_message" text NOT NULL,
	"status" varchar(50) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_data_quality_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"event_match" varchar(100) NOT NULL,
	"condition" jsonb NOT NULL,
	"severity" varchar(50) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_dead_letter_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_queue" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"error_reason" text NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_destination_delivery_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"delivery_status" varchar(50) NOT NULL,
	"status_code" integer,
	"error_details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_destination_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"event_name" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_gtm_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "measurement_gtm_accounts_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_gtm_containers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" varchar(100) NOT NULL,
	"container_id" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"usage_context" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "measurement_gtm_containers_container_id_unique" UNIQUE("container_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_gtm_sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"container_id" varchar(100) NOT NULL,
	"action" varchar(100) NOT NULL,
	"status" varchar(50) NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_gtm_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"container_id" varchar(100) NOT NULL,
	"version_id" varchar(100) NOT NULL,
	"name" varchar(255),
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "measurement_gtm_versions_version_id_unique" UNIQUE("version_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_gtm_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"container_id" varchar(100) NOT NULL,
	"workspace_id" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "measurement_gtm_workspaces_workspace_id_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"severity" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'investigating' NOT NULL,
	"description" text,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_paid_social_delivery_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"event_name" varchar(100) NOT NULL,
	"delivery_status" varchar(50) NOT NULL,
	"status_code" integer,
	"error_details" text,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_paid_social_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"credential_status" varchar(50) DEFAULT 'unconfigured' NOT NULL,
	"required_consent" jsonb NOT NULL,
	"allowed_fields" jsonb NOT NULL,
	"blocked_fields" jsonb NOT NULL,
	"hashing_rules" jsonb NOT NULL,
	"deduplication_keys" jsonb NOT NULL,
	"retry_policy" jsonb NOT NULL,
	"risk_level" varchar(50) DEFAULT 'medium' NOT NULL,
	"owner_role" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_paid_social_event_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"internal_event_name" varchar(100) NOT NULL,
	"platform_event_name" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_qa_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"release_request_id" uuid,
	"status" varchar(50) NOT NULL,
	"actual_result" jsonb,
	"error_log" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_qa_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(100) NOT NULL,
	"payload_template" jsonb,
	"expected_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_release_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"release_request_id" uuid NOT NULL,
	"role" varchar(100) NOT NULL,
	"status" varchar(50) NOT NULL,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_release_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"gtm_workspace_id" varchar(100),
	"diff_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"change_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "measurement_vendor_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"domain" varchar(255),
	"privacy_policy_url" text,
	"data_processing_agreement" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"change_reason" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_state_fp_client_idx" ON "consent_current_state" ("fp_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_state_user_idx" ON "consent_current_state" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_fp_client_idx" ON "consent_records" ("fp_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_user_idx" ON "consent_records" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consent_created_at_idx" ON "consent_records" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribution_fp_client_idx" ON "attribution_touchpoints" ("fp_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribution_user_idx" ON "attribution_touchpoints" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribution_order_idx" ON "attribution_touchpoints" ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribution_event_name_idx" ON "attribution_touchpoints" ("event_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attribution_event_time_idx" ON "attribution_touchpoints" ("event_time");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zero_party_fp_client_idx" ON "zero_party_signals" ("fp_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zero_party_user_idx" ON "zero_party_signals" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "zero_party_signal_type_idx" ON "zero_party_signals" ("signal_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_attr_fp_idx" ON "measurement_campaign_attribution" ("fp_client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_attr_user_idx" ON "measurement_campaign_attribution" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_attr_src_med_idx" ON "measurement_campaign_attribution" ("utm_source","utm_medium");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dash_metric_time_idx" ON "measurement_dashboard_metrics" ("metric_name","timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dest_log_event_idx" ON "measurement_destination_delivery_logs" ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dest_log_status_idx" ON "measurement_destination_delivery_logs" ("delivery_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paid_social_log_event_idx" ON "measurement_paid_social_delivery_logs" ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "paid_social_log_dest_status_idx" ON "measurement_paid_social_delivery_logs" ("destination_id","delivery_status");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_admin_permissions" ADD CONSTRAINT "measurement_admin_permissions_role_id_measurement_admin_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "measurement_admin_roles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_data_quality_alerts" ADD CONSTRAINT "measurement_data_quality_alerts_rule_id_measurement_data_quality_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "measurement_data_quality_rules"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_destination_delivery_logs" ADD CONSTRAINT "measurement_destination_delivery_logs_destination_id_measurement_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "measurement_destinations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_destination_routes" ADD CONSTRAINT "measurement_destination_routes_destination_id_measurement_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "measurement_destinations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_gtm_containers" ADD CONSTRAINT "measurement_gtm_containers_account_id_measurement_gtm_accounts_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "measurement_gtm_accounts"("account_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_gtm_versions" ADD CONSTRAINT "measurement_gtm_versions_container_id_measurement_gtm_containers_container_id_fk" FOREIGN KEY ("container_id") REFERENCES "measurement_gtm_containers"("container_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_gtm_workspaces" ADD CONSTRAINT "measurement_gtm_workspaces_container_id_measurement_gtm_containers_container_id_fk" FOREIGN KEY ("container_id") REFERENCES "measurement_gtm_containers"("container_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_paid_social_delivery_logs" ADD CONSTRAINT "measurement_paid_social_delivery_logs_destination_id_measurement_paid_social_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "measurement_paid_social_destinations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_paid_social_event_mappings" ADD CONSTRAINT "measurement_paid_social_event_mappings_destination_id_measurement_paid_social_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "measurement_paid_social_destinations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_qa_results" ADD CONSTRAINT "measurement_qa_results_test_id_measurement_qa_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "measurement_qa_tests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_qa_results" ADD CONSTRAINT "measurement_qa_results_release_request_id_measurement_release_requests_id_fk" FOREIGN KEY ("release_request_id") REFERENCES "measurement_release_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "measurement_release_approvals" ADD CONSTRAINT "measurement_release_approvals_release_request_id_measurement_release_requests_id_fk" FOREIGN KEY ("release_request_id") REFERENCES "measurement_release_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
