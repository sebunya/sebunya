CREATE TABLE IF NOT EXISTS "delivery_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"district" varchar(100) NOT NULL,
	"fee_ugx" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_live_canaries" (
	"id" text PRIMARY KEY NOT NULL,
	"dry_run_id" text NOT NULL,
	"activation_request_id" text NOT NULL,
	"status" text NOT NULL,
	"canary_cap" integer NOT NULL,
	"destination_allowlist" jsonb NOT NULL,
	"rollback_plan" text NOT NULL,
	"monitoring_owner" text NOT NULL,
	"rollback_reason" text,
	"rollback_owner" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_live_canary_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"canary_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_admin_id" text NOT NULL,
	"reason" text,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_live_canary_delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"canary_id" text NOT NULL,
	"destination" text NOT NULL,
	"status" text NOT NULL,
	"redacted_payload_summary" text NOT NULL,
	"redacted_response_summary" text NOT NULL,
	"attempted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "controlled_live_canary_evidence_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"canary_id" text NOT NULL,
	"eligibility_summary" text NOT NULL,
	"delivery_attempt_summary" text NOT NULL,
	"consent_summary" text NOT NULL,
	"destination_summary" text NOT NULL,
	"rollback_summary" text NOT NULL,
	"monitoring_summary" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_location" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_fee_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "client_order_key" varchar(80);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "delivery_zones_district_idx" ON "delivery_zones" ("district");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_client_order_key_idx" ON "orders" ("client_order_key");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_live_canaries" ADD CONSTRAINT "controlled_live_canaries_dry_run_id_controlled_activation_dry_runs_id_fk" FOREIGN KEY ("dry_run_id") REFERENCES "controlled_activation_dry_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_live_canaries" ADD CONSTRAINT "controlled_live_canaries_activation_request_id_controlled_activation_requests_id_fk" FOREIGN KEY ("activation_request_id") REFERENCES "controlled_activation_requests"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_live_canary_audit_logs" ADD CONSTRAINT "controlled_live_canary_audit_logs_canary_id_controlled_live_canaries_id_fk" FOREIGN KEY ("canary_id") REFERENCES "controlled_live_canaries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_live_canary_delivery_attempts" ADD CONSTRAINT "controlled_live_canary_delivery_attempts_canary_id_controlled_live_canaries_id_fk" FOREIGN KEY ("canary_id") REFERENCES "controlled_live_canaries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "controlled_live_canary_evidence_packs" ADD CONSTRAINT "controlled_live_canary_evidence_packs_canary_id_controlled_live_canaries_id_fk" FOREIGN KEY ("canary_id") REFERENCES "controlled_live_canaries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
