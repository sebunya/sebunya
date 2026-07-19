CREATE TABLE IF NOT EXISTS "customer_profiles" (
	"canonical_customer_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"source_version" integer DEFAULT 0 NOT NULL,
	"account_user_id" uuid,
	"identity_confidence" varchar(16) DEFAULT 'LOW' NOT NULL,
	"first_seen" timestamp with time zone,
	"last_seen" timestamp with time zone,
	"primary_lifecycle_stage" varchar(20) DEFAULT 'UNKNOWN' NOT NULL,
	"value_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consent_eligible" boolean,
	"communication_preferences" jsonb,
	"stale_after_hours" integer DEFAULT 24 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_identity_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_customer_id" uuid NOT NULL,
	"signal_type" varchar(40) NOT NULL,
	"identifier_key" varchar(128) NOT NULL,
	"confidence" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_feature_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_customer_id" uuid NOT NULL,
	"source_version" integer NOT NULL,
	"features" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_lifecycle_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_customer_id" uuid NOT NULL,
	"stage" varchar(20) NOT NULL,
	"policy_version" integer NOT NULL,
	"source_version" integer NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nba_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_customer_id" uuid NOT NULL,
	"profile_version" integer NOT NULL,
	"selected_action" varchar(30) NOT NULL,
	"selected_target_ref" varchar(128),
	"reason_codes" jsonb NOT NULL,
	"policy_version" integer NOT NULL,
	"decision_key" varchar(200) NOT NULL,
	"activation_state" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nba_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"action_type" varchar(30) NOT NULL,
	"target_ref" varchar(128),
	"eligible" boolean NOT NULL,
	"exclusion_reason" varchar(40),
	"score" integer NOT NULL,
	"reason_codes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_identity_links_signal_identifier_idx" ON "customer_identity_links" ("signal_type","identifier_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_identity_links_canonical_idx" ON "customer_identity_links" ("canonical_customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_profiles_account_idx" ON "customer_profiles" ("account_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_profiles_lifecycle_idx" ON "customer_profiles" ("primary_lifecycle_stage");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_feature_snapshots_version_idx" ON "customer_feature_snapshots" ("canonical_customer_id","source_version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_lifecycle_snapshots_version_idx" ON "customer_lifecycle_snapshots" ("canonical_customer_id","source_version","policy_version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "nba_decisions_key_idx" ON "nba_decisions" ("decision_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nba_decisions_canonical_idx" ON "nba_decisions" ("canonical_customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nba_candidates_decision_idx" ON "nba_candidates" ("decision_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_account_user_id_users_id_fk" FOREIGN KEY ("account_user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_identity_links" ADD CONSTRAINT "customer_identity_links_canonical_customer_id_customer_profiles_canonical_customer_id_fk" FOREIGN KEY ("canonical_customer_id") REFERENCES "customer_profiles"("canonical_customer_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_feature_snapshots" ADD CONSTRAINT "customer_feature_snapshots_canonical_customer_id_customer_profiles_canonical_customer_id_fk" FOREIGN KEY ("canonical_customer_id") REFERENCES "customer_profiles"("canonical_customer_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_lifecycle_snapshots" ADD CONSTRAINT "customer_lifecycle_snapshots_canonical_customer_id_customer_profiles_canonical_customer_id_fk" FOREIGN KEY ("canonical_customer_id") REFERENCES "customer_profiles"("canonical_customer_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nba_decisions" ADD CONSTRAINT "nba_decisions_canonical_customer_id_customer_profiles_canonical_customer_id_fk" FOREIGN KEY ("canonical_customer_id") REFERENCES "customer_profiles"("canonical_customer_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nba_candidates" ADD CONSTRAINT "nba_candidates_decision_id_nba_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "nba_decisions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
